import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { setRavenLLMClient } from '../../../../embedded/raven-llm-client'
import { getAllExtensionState, getGlobalState, getUserId, resetExtensionState, updateGlobalState } from '../state'

const originalEmbeddedEnv = process.env.CHATERM_EMBEDDED

describe('main storage embedded fallback', () => {
  beforeEach(async () => {
    process.env.CHATERM_EMBEDDED = '1'
    setRavenLLMClient({ marker: 'client' } as never)
    await resetExtensionState()
  })

  afterEach(() => {
    if (originalEmbeddedEnv === undefined) {
      delete process.env.CHATERM_EMBEDDED
    } else {
      process.env.CHATERM_EMBEDDED = originalEmbeddedEnv
    }
    setRavenLLMClient(null)
  })

  it('returns a Raven bridge extension state without a standalone Chaterm window', async () => {
    const state = await getAllExtensionState()

    expect(state.apiConfiguration.apiProvider).toBe('raven-bridge')
    expect(state.apiConfiguration.ravenLLMClient).toEqual({ marker: 'client' })
    expect(state.autoApprovalSettings.enabled).toBe(false)
    expect(state.chatSettings.mode).toBe('agent')
    expect(state.userRules).toEqual([])
    expect(await getUserId()).toBe(999999999)
  })

  it('persists embedded global state in process memory', async () => {
    await updateGlobalState('chatSettings', { mode: 'chat' })

    expect(await getGlobalState('chatSettings')).toEqual({ mode: 'chat' })
    expect((await getAllExtensionState()).chatSettings).toEqual({ mode: 'chat' })
  })
})
