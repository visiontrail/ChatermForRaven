import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '../types'
import { findResponseDuration, findResponseModelId } from '../responseModel'

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

describe('findResponseDuration', () => {
  const completedRequest = (ts: number, completedAt: number) => ({
    say: 'api_req_started',
    ts,
    text: JSON.stringify({ modelId: 'served-model', completedAt })
  })
  it('includes tool time between requests and isolates conversation turns', () => {
    const history = [completedRequest(1000, 2000), completedRequest(5000, 8000), completedRequest(12000, 15340), completedRequest(20000, 25000)]
    expect(findResponseDuration(history, 14000, 4000)).toBe('10.34s')
    expect(findResponseDuration(history, 23000, 19000)).toBe('5.00s')
  })
  it('uses persisted completion instead of the first streamed text timestamp', () => {
    expect(findResponseDuration([completedRequest(1000, 204940)], 1500, 900)).toBe('203.94s')
  })
  it('handles restored renderer metadata and zero duration', () => {
    expect(findResponseDuration([{ say: 'api_req_started', ts: 1000, content: { completedAt: 1000 } }], 1000)).toBe('0.00s')
  })
  it('omits unknown or invalid timing instead of inventing legacy durations', () => {
    for (const content of ['not json', '{}', 'null', '{"completedAt":"2000"}', '{"completedAt":-1}']) {
      expect(findResponseDuration([{ say: 'api_req_started', ts: 1000, content }], 1500)).toBeUndefined()
    }
    expect(findResponseDuration([], 1500)).toBeUndefined()
    expect(findResponseDuration([completedRequest(1000, 2000)], undefined)).toBeUndefined()
    expect(findResponseDuration([completedRequest(1000, 2000)], 3000, 2500)).toBeUndefined()
  })
})
