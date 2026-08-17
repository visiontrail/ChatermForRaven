import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '../types'
import { findResponseModelId } from '../responseModel'

const apiRequest = (ts: number, modelId: string): ChatMessage => ({
  id: `request-${ts}`,
  role: 'assistant',
  say: 'api_req_started',
  ts,
  content: JSON.stringify({ modelId })
})

describe('findResponseModelId', () => {
  it('uses the latest completed request at or before the response', () => {
    const history = [apiRequest(100, 'primary-model'), apiRequest(200, 'backup-model')]

    expect(findResponseModelId(history, 250)).toBe('backup-model')
    expect(findResponseModelId(history, 150)).toBe('primary-model')
  })

  it('ignores malformed legacy request metadata', () => {
    const history: ChatMessage[] = [{ id: 'legacy', role: 'assistant', say: 'api_req_started', ts: 100, content: 'not json' }]

    expect(findResponseModelId(history, 200)).toBeUndefined()
  })

  it('reads model metadata from raw main-process state messages', () => {
    expect(findResponseModelId([{ say: 'api_req_started', ts: 100, text: JSON.stringify({ modelId: 'served-model' }) }], 200)).toBe('served-model')
  })
})
