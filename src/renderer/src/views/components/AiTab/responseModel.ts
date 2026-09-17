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

/** Wall time across this turn's requests, including tool execution between them.
 * Legacy histories without a persisted completion time intentionally omit duration.
 */
export function findResponseDuration(history: ResponseModelHistoryMessage[], responseTimestamp?: number, userTimestamp?: number): string | undefined {
  if (responseTimestamp === undefined) return undefined
  const requests = history.filter(
    (message) =>
      message.say === 'api_req_started' &&
      message.ts !== undefined &&
      message.ts <= responseTimestamp &&
      (userTimestamp === undefined || message.ts >= userTimestamp)
  )
  const lastRequest = requests.at(-1)
  if (!lastRequest) return undefined
  let metadata = lastRequest.text ?? lastRequest.content
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata)
    } catch {
      return undefined
    }
  }
  const completedAt = (metadata as { completedAt?: unknown } | null)?.completedAt
  const startedAt = userTimestamp === undefined ? lastRequest.ts : requests[0]?.ts
  if (typeof completedAt !== 'number' || !Number.isFinite(completedAt) || startedAt === undefined || completedAt < startedAt) {
    return undefined
  }
  return `${((completedAt - startedAt) / 1000).toFixed(2)}s`
}
