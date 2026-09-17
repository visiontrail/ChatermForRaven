import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setRavenLLMClient } from '../../../../embedded/raven-llm-client'
import { getAllExtensionState, getGlobalState, getModelOptions, getUserId, resetExtensionState, updateGlobalState } from '../state'

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
    expect(state.apiConfiguration.defaultModelId).toBeUndefined()
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

  it('resolves primary and backup selection from the live Raven bridge without a standalone window', async () => {
    const listAvailableModels = vi.fn().mockResolvedValue([
      { modelId: 'primary-model', displayName: 'Primary-Thinking' },
      { modelId: 'backup-model', displayName: 'Backup' }
    ])
    setRavenLLMClient({ listAvailableModels } as never)

    expect(await getModelOptions()).toEqual([
      { id: 'primary-model', name: 'Primary-Thinking', checked: true, type: 'standard', apiProvider: 'raven-bridge' },
      { id: 'backup-model', name: 'Backup', checked: true, type: 'standard', apiProvider: 'raven-bridge' }
    ])
    expect(await getModelOptions(true)).toEqual([
      { id: 'backup-model', name: 'Backup', checked: true, type: 'standard', apiProvider: 'raven-bridge' }
    ])

    listAvailableModels.mockResolvedValue([{ modelId: 'new-backup', displayName: '' }])
    expect(await getModelOptions()).toEqual([{ id: 'new-backup', name: 'new-backup', checked: true, type: 'standard', apiProvider: 'raven-bridge' }])
  })

  it('returns no models when the embedded bridge is absent or unavailable', async () => {
    setRavenLLMClient(null)
    expect(await getModelOptions()).toEqual([])

    setRavenLLMClient({ listAvailableModels: vi.fn().mockRejectedValue(new Error('bridge unavailable')) } as never)
    expect(await getModelOptions()).toEqual([])
  })
})
