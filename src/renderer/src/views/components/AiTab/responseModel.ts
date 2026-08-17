interface ApiRequestModelMeta {
  modelId?: unknown
}

export interface ResponseModelHistoryMessage {
  say?: string
  ts?: number
  text?: unknown
  content?: unknown
}

function readModelId(message: ResponseModelHistoryMessage): string | undefined {
  let value: unknown = message.text ?? message.content
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return undefined
    }
  }
  const modelId = (value as ApiRequestModelMeta | null)?.modelId
  return typeof modelId === 'string' && modelId.trim() ? modelId.trim() : undefined
}

export function findResponseModelId(history: ResponseModelHistoryMessage[], responseTimestamp?: number): string | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index]
    if (message.say !== 'api_req_started') continue
    if (responseTimestamp && message.ts && message.ts > responseTimestamp) continue
    const modelId = readModelId(message)
    if (modelId) return modelId
  }
  return undefined
}
