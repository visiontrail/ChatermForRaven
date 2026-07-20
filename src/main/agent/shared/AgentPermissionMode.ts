import type { AutoApprovalSettings } from './AutoApprovalSettings'

export type AgentPermissionMode = 'ask' | 'read-only' | 'full'

export function getAgentPermissionMode(settings: AutoApprovalSettings): AgentPermissionMode {
  if (settings.enabled && settings.actions.executeSafeCommands && settings.actions.executeAllCommands) {
    return 'full'
  }

  if (settings.actions.autoExecuteReadOnlyCommands) {
    return 'read-only'
  }

  return 'ask'
}

export function applyAgentPermissionMode(settings: AutoApprovalSettings, mode: AgentPermissionMode): AutoApprovalSettings {
  const autoExecuteReadOnlyCommands = mode !== 'ask'
  const bypassAllCommands = mode === 'full'

  return {
    ...settings,
    version: (settings.version || 1) + 1,
    enabled: bypassAllCommands,
    actions: {
      ...settings.actions,
      executeSafeCommands: true,
      executeAllCommands: bypassAllCommands,
      autoExecuteReadOnlyCommands
    },
    favorites: [...(settings.favorites || [])]
  }
}

export function isAutoApprovalSettings(value: unknown): value is AutoApprovalSettings {
  if (!value || typeof value !== 'object') return false

  const settings = value as Partial<AutoApprovalSettings>
  const actions = settings.actions as Partial<AutoApprovalSettings['actions']> | undefined

  return (
    typeof settings.version === 'number' &&
    typeof settings.enabled === 'boolean' &&
    !!actions &&
    typeof actions.executeSafeCommands === 'boolean' &&
    typeof actions.executeAllCommands === 'boolean' &&
    typeof actions.autoExecuteReadOnlyCommands === 'boolean' &&
    typeof settings.maxRequests === 'number' &&
    Number.isFinite(settings.maxRequests) &&
    settings.maxRequests > 0 &&
    typeof settings.enableNotifications === 'boolean' &&
    Array.isArray(settings.favorites)
  )
}
