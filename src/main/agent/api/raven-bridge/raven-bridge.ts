//  Copyright (c) 2025-present, chaterm.ai  All rights reserved.
//  This source code is licensed under the GPL-3.0

import { randomUUID } from 'crypto'

import { Anthropic } from '@anthropic-ai/sdk'

import type { ApiHandler } from '../index'
import type { ApiStream, ApiStreamUsageChunk } from '../transform/stream'
import { ApiHandlerOptions, ModelInfo } from '@shared/api'

import { formatToolParamsXml } from './tool-use-xml'
import type { BridgeMessage, BridgeStreamEvent, CreateMessageRequest, RavenLLMClient } from './types'

const logger = createLogger('agent')

interface ToolCallState {
  name: string
  jsonParts: string[]
  opened: boolean
}

const DEFAULT_FIRST_MODEL_EVENT_TIMEOUT_MS = 60_000

function getFirstModelEventTimeoutMs(): number {
  const raw = process.env.CHATERM_RAVEN_BRIDGE_FIRST_EVENT_TIMEOUT_MS
  if (!raw) return DEFAULT_FIRST_MODEL_EVENT_TIMEOUT_MS

  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_FIRST_MODEL_EVENT_TIMEOUT_MS
}

function toBridgeMessages(messages: Anthropic.Messages.MessageParam[]): BridgeMessage[] {
  return messages.map((message) => ({
    role: message.role as BridgeMessage['role'],
    content: message.content
  }))
}

function parseToolInput(state: ToolCallState, finalInput: unknown): Record<string, unknown> {
  if (finalInput && typeof finalInput === 'object' && !Array.isArray(finalInput)) {
    return finalInput as Record<string, unknown>
  }

  const raw = [...state.jsonParts, typeof finalInput === 'string' ? finalInput : ''].join('').trim()
  if (!raw) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch (error) {
    logger.warn('Failed to parse streamed tool input JSON', { error, toolName: state.name })
  }

  return {}
}

function waitForQueue<T>(queue: T[], wake: { current?: () => void }, timeoutMs?: number): Promise<void> {
  if (queue.length > 0) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        wake.current = undefined
        reject(new Error(`Timed out waiting for Raven LLM bridge model event after ${timeoutMs}ms`))
      }, timeoutMs)
    }

    wake.current = () => {
      if (timer) clearTimeout(timer)
      resolve()
    }
  })
}

export class RavenBridgeHandler implements ApiHandler {
  private readonly client: RavenLLMClient
  private readonly options: ApiHandlerOptions
  private lastUsage?: ApiStreamUsageChunk
  private resolvedModelId?: string

  constructor(client: RavenLLMClient, options: ApiHandlerOptions = {}) {
    this.client = client
    this.options = options
  }

  async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
    const requestId = randomUUID()
    const queue: BridgeStreamEvent[] = []
    const wake: { current?: () => void } = {}
    const toolCalls = new Map<string, ToolCallState>()
    let streamEnded = false
    let sawTerminalEnd = false
    let sawModelEvent = false
    const firstModelEventTimeoutMs = getFirstModelEventTimeoutMs()

    const unsubscribe = this.client.onStreamEvent(requestId, (event) => {
      queue.push(event)
      wake.current?.()
      wake.current = undefined
    })

    const request: CreateMessageRequest = {
      requestId,
      systemPrompt,
      messages: toBridgeMessages(messages),
      modelId: this.options.defaultModelId ?? this.options.apiModelId ?? this.options.anthropicModelId ?? this.options.openAiModelId
    }

    try {
      await this.client.createMessage(request)

      while (!streamEnded) {
        await waitForQueue(queue, wake, sawModelEvent ? undefined : firstModelEventTimeoutMs)
        const event = queue.shift()
        if (!event) {
          continue
        }

        switch (event.type) {
          case 'start':
            this.resolvedModelId = event.modelId
            break

          case 'text':
            sawModelEvent = true
            yield { type: 'text', text: event.delta }
            break

          case 'usage': {
            sawModelEvent = true
            const usageChunk: ApiStreamUsageChunk = {
              type: 'usage',
              inputTokens: event.inputTokens,
              outputTokens: event.outputTokens,
              cacheReadTokens: event.cacheRead,
              cacheWriteTokens: event.cacheWrite
            }
            this.lastUsage = usageChunk
            yield usageChunk
            break
          }

          case 'tool_use_start': {
            sawModelEvent = true
            const state: ToolCallState = {
              name: event.name,
              jsonParts: event.partialInput ? [event.partialInput] : [],
              opened: false
            }
            toolCalls.set(event.toolCallId, state)
            yield { type: 'text', text: `<${event.name}>` }
            state.opened = true
            break
          }

          case 'tool_use_delta': {
            sawModelEvent = true
            const state = toolCalls.get(event.toolCallId)
            if (state) {
              state.jsonParts.push(event.inputJsonDelta)
            }
            break
          }

          case 'tool_use_end': {
            sawModelEvent = true
            const state = toolCalls.get(event.toolCallId)
            if (state) {
              const input = parseToolInput(state, event.finalInput)
              const paramsXml = formatToolParamsXml(input)
              const suffix = paramsXml.length > 0 ? `\n${paramsXml}\n</${state.name}>` : `</${state.name}>`
              yield { type: 'text', text: suffix }
              toolCalls.delete(event.toolCallId)
            }
            break
          }

          case 'end':
            sawModelEvent = true
            streamEnded = true
            sawTerminalEnd = true
            if (event.finishReason === 'error') {
              throw new Error(event.error ?? 'Raven LLM bridge request failed')
            }
            break
        }
      }
    } finally {
      unsubscribe()
      if (!sawTerminalEnd) {
        logger.warn('Raven LLM bridge stream ended without terminal event; aborting request', { requestId })
        void this.client.abort(requestId).catch((error) => {
          logger.warn('Failed to abort Raven LLM bridge request', { requestId, error })
        })
      }
    }
  }

  getModel(): { id: string; info: ModelInfo } {
    const id =
      this.resolvedModelId ??
      this.options.defaultModelId ??
      this.options.apiModelId ??
      this.options.anthropicModelId ??
      this.options.openAiModelId ??
      'raven-default'

    return {
      id,
      info: {
        supportsPromptCache: false,
        maxTokens: 8192,
        contextWindow: 128_000,
        description: 'Model configured in Raven settings'
      }
    }
  }

  async getApiStreamUsage(): Promise<ApiStreamUsageChunk | undefined> {
    return this.lastUsage
  }

  async validateApiKey(): Promise<{ isValid: boolean; error?: string }> {
    try {
      const models = await this.client.listAvailableModels()
      if (models.length === 0) {
        return { isValid: false, error: 'No Raven models are configured' }
      }
      return { isValid: true }
    } catch (error) {
      logger.error('Raven LLM bridge validation failed', { error })
      return {
        isValid: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
}
