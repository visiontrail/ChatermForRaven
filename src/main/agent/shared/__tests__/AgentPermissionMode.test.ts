import { describe, expect, it } from 'vitest'

import { DEFAULT_AUTO_APPROVAL_SETTINGS } from '../AutoApprovalSettings'
import { applyAgentPermissionMode, getAgentPermissionMode, isAutoApprovalSettings } from '../AgentPermissionMode'

describe('AgentPermissionMode', () => {
  it.each([
    ['ask', false, false, false],
    ['read-only', false, false, true],
    ['full', true, true, true]
  ] as const)('maps %s to auto approval settings', (mode, enabled, executeAllCommands, autoExecuteReadOnlyCommands) => {
    const settings = applyAgentPermissionMode(DEFAULT_AUTO_APPROVAL_SETTINGS, mode)

    expect(settings.enabled).toBe(enabled)
    expect(settings.actions.executeSafeCommands).toBe(true)
    expect(settings.actions.executeAllCommands).toBe(executeAllCommands)
    expect(settings.actions.autoExecuteReadOnlyCommands).toBe(autoExecuteReadOnlyCommands)
    expect(getAgentPermissionMode(settings)).toBe(mode)
  })

  it('preserves unrelated settings and clones favorites', () => {
    const settings = applyAgentPermissionMode(DEFAULT_AUTO_APPROVAL_SETTINGS, 'read-only')

    expect(settings.maxRequests).toBe(DEFAULT_AUTO_APPROVAL_SETTINGS.maxRequests)
    expect(settings.enableNotifications).toBe(DEFAULT_AUTO_APPROVAL_SETTINGS.enableNotifications)
    expect(settings.favorites).toEqual(DEFAULT_AUTO_APPROVAL_SETTINGS.favorites)
    expect(settings.favorites).not.toBe(DEFAULT_AUTO_APPROVAL_SETTINGS.favorites)
  })

  it('rejects malformed IPC payloads', () => {
    expect(isAutoApprovalSettings(DEFAULT_AUTO_APPROVAL_SETTINGS)).toBe(true)
    expect(isAutoApprovalSettings({ enabled: true })).toBe(false)
    expect(isAutoApprovalSettings({ ...DEFAULT_AUTO_APPROVAL_SETTINGS, maxRequests: 0 })).toBe(false)
  })
})
