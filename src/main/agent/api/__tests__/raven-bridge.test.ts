import { describe, expect, it, vi } from 'vitest'

import { buildApiHandler } from '../index'
import { RavenBridgeHandler } from '../raven-bridge/raven-bridge'
import type { BridgeStreamEvent, RavenLLMClient } from '../raven-bridge/types'

function createMockClient(events: BridgeStreamEvent[]): RavenLLMClient & {
  abort: ReturnType<typeof vi.fn>
  createMessage: ReturnType<typeof vi.fn>
} {
  const listeners = new Map<string, (event: BridgeStreamEvent) => void>()

  const createMessage = vi.fn(async (request: { requestId: string }) => {
    queueMicrotask(() => {
      const listener = listeners.get(request.requestId)
      if (!listener) {
        return
      }
      for (const event of events) {
        listener(event)
      }
    })
    return { requestId: request.requestId }
  })

  const abort = vi.fn(async () => undefined)

  return {
    listAvailableModels: vi.fn(async () => [
      {
        providerId: 'anthropic',
        modelId: 'claude-3-5-sonnet',
        displayName: 'Claude 3.5 Sonnet',
        capabilities: { tools: true, vision: true, streaming: true }
      }
    ]),
    createMessage,
    abort,
    onStreamEvent: (requestId, listener) => {
      listeners.set(requestId, listener)
      return () => listeners.delete(requestId)
    }
  }
}

async function collectStream(handler: RavenBridgeHandler, userText = 'hello'): Promise<Array<{ type: string; text?: string }>> {
  const stream = handler.createMessage('system prompt', [{ role: 'user', content: userText }])
  const chunks: Array<{ type: string; text?: string }> = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }
  return chunks
}

describe('RavenBridgeHandler', () => {
  it('maps text, usage, and end events to ApiStream chunks', async () => {
    const client = createMockClient([
      { type: 'start', modelId: 'claude-3-5-sonnet', createdAt: Date.now() },
      { type: 'text', delta: 'Hello' },
      { type: 'text', delta: ' world' },
      { type: 'usage', inputTokens: 10, outputTokens: 4 },
      { type: 'end', finishReason: 'stop' }
    ])

    const handler = new RavenBridgeHandler(client)
    const chunks = await collectStream(handler)

    expect(
      chunks
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('')
    ).toBe('Hello world')
    expect(chunks).toContainEqual({
      type: 'usage',
      inputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined
    })
    expect(handler.getModel().id).toBe('claude-3-5-sonnet')
  })

  it('maps reasoning events to ApiStream reasoning chunks and treats them as model activity', async () => {
    const previousTimeout = process.env.CHATERM_RAVEN_BRIDGE_FIRST_EVENT_TIMEOUT_MS
    process.env.CHATERM_RAVEN_BRIDGE_FIRST_EVENT_TIMEOUT_MS = '50'
    const client = createMockClient([
      { type: 'start', modelId: 'glm-4.6', createdAt: Date.now() },
      { type: 'reasoning', delta: 'thinking…' },
      { type: 'text', delta: 'answer' },
      { type: 'end', finishReason: 'stop' }
    ])
    const handler = new RavenBridgeHandler(client)

    try {
      const chunks = await collectStream(handler)
      expect(chunks).toContainEqual({ type: 'reasoning', reasoning: 'thinking…' })
      expect(chunks).toContainEqual({ type: 'text', text: 'answer' })
      expect(client.abort).not.toHaveBeenCalled()
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.CHATERM_RAVEN_BRIDGE_FIRST_EVENT_TIMEOUT_MS
      } else {
        process.env.CHATERM_RAVEN_BRIDGE_FIRST_EVENT_TIMEOUT_MS = previousTimeout
      }
    }
  })

  it('maps tool_use events into Chaterm XML text chunks', async () => {
    const client = createMockClient([
      { type: 'tool_use_start', toolCallId: 'tool-1', name: 'execute_command' },
      { type: 'tool_use_delta', toolCallId: 'tool-1', inputJsonDelta: '{"command":"ls"}' },
      { type: 'tool_use_end', toolCallId: 'tool-1', finalInput: { command: 'ls' } },
      { type: 'end', finishReason: 'tool_use' }
    ])

    const handler = new RavenBridgeHandler(client)
    const chunks = await collectStream(handler)
    const text = chunks
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('')

    expect(text).toContain('<execute_command>')
    expect(text).toContain('<command>ls</command>')
    expect(text).toContain('</execute_command>')
  })

  it('aborts in-flight bridge requests when the consumer closes the stream early', async () => {
    const client = createMockClient([{ type: 'text', delta: 'partial' }])
    const handler = new RavenBridgeHandler(client)
    const stream = handler.createMessage('system', [{ role: 'user', content: 'hello' }])

    const first = await stream.next()
    expect(first.value).toEqual({ type: 'text', text: 'partial' })

    await stream.return(undefined)
    expect(client.abort).toHaveBeenCalledTimes(1)
    expect(client.abort.mock.calls[0][0]).toEqual(expect.any(String))
  })

  it('does not throw when the bridge ends with finishReason=abort', async () => {
    const client = createMockClient([
      { type: 'text', delta: 'partial' },
      { type: 'end', finishReason: 'abort' }
    ])
    const handler = new RavenBridgeHandler(client)

    await expect(collectStream(handler)).resolves.toBeDefined()
  })

  it('aborts when the bridge never receives a model event after start', async () => {
    const previousTimeout = process.env.CHATERM_RAVEN_BRIDGE_FIRST_EVENT_TIMEOUT_MS
    process.env.CHATERM_RAVEN_BRIDGE_FIRST_EVENT_TIMEOUT_MS = '5'
    const client = createMockClient([{ type: 'start', modelId: 'claude-3-5-sonnet', createdAt: Date.now() }])
    const handler = new RavenBridgeHandler(client)

    try {
      await expect(collectStream(handler)).rejects.toThrow(/Timed out waiting for Raven LLM bridge model event/)
      expect(client.abort).toHaveBeenCalledTimes(1)
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.CHATERM_RAVEN_BRIDGE_FIRST_EVENT_TIMEOUT_MS
      } else {
        process.env.CHATERM_RAVEN_BRIDGE_FIRST_EVENT_TIMEOUT_MS = previousTimeout
      }
    }
  })
})

describe('buildApiHandler raven-bridge', () => {
  it('returns RavenBridgeHandler when raven-bridge provider is selected', () => {
    const client = createMockClient([{ type: 'end', finishReason: 'stop' }])
    const handler = buildApiHandler({ apiProvider: 'raven-bridge', ravenLLMClient: client })
    expect(handler).toBeInstanceOf(RavenBridgeHandler)
  })
})
