/** Wire protocol shared with Raven's `raven:llm:*` bridge. Kept in shared/ so both
 *  tsconfig.node.json and tsconfig.web.json can reference it without crossing the
 *  api/ exclude boundary. */

export type FinishReason = 'stop' | 'length' | 'tool_use' | 'abort' | 'error'

export type BridgeStreamEvent =
  | { type: 'start'; modelId: string; createdAt: number }
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool_use_start'; toolCallId: string; name: string; partialInput?: string }
  | { type: 'tool_use_delta'; toolCallId: string; inputJsonDelta: string }
  | { type: 'tool_use_end'; toolCallId: string; finalInput: unknown }
  | {
      type: 'usage'
      inputTokens: number
      outputTokens: number
      cacheRead?: number
      cacheWrite?: number
    }
  | { type: 'end'; finishReason: FinishReason; error?: string }

export interface ModelCapabilities {
  tools: boolean
  vision: boolean
  streaming: boolean
}

export interface AvailableModel {
  providerId: string
  modelId: string
  displayName: string
  capabilities: ModelCapabilities
}

export interface BridgeMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: unknown
}

export interface CreateMessageRequest {
  requestId: string
  systemPrompt?: string
  messages: BridgeMessage[]
  tools?: unknown[]
  modelId?: string
}

export interface CreateMessageAck {
  requestId: string
}

/**
 * In-process client for Raven's LLM bridge. In embedded mode Raven injects an
 * implementation when mounting Chaterm; unit tests pass a mock.
 */
export interface RavenLLMClient {
  listAvailableModels(): Promise<AvailableModel[]>
  createMessage(request: CreateMessageRequest): Promise<CreateMessageAck>
  abort(requestId: string): Promise<void>
  onStreamEvent(requestId: string, listener: (event: BridgeStreamEvent) => void): () => void
}
