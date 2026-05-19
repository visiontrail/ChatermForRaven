/**
 * Renderer-side embedded mode detection (Chaterm inside Raven webview).
 */
export function isChatermEmbedded(): boolean {
  const buildFlag = import.meta.env.RENDERER_CHATERM_EMBEDDED
  if (buildFlag === '1' || buildFlag === 'true') {
    return true
  }

  try {
    if (typeof window !== 'undefined' && window.location?.protocol === 'raven-chaterm:') {
      return true
    }
  } catch {
    // ignore
  }

  return false
}

/** User-config fields owned by Raven in embedded mode (no local persistence). */
export const RAVEN_OWNED_USER_CONFIG_FIELDS = ['language', 'theme'] as const

export type RavenOwnedUserConfigField = (typeof RAVEN_OWNED_USER_CONFIG_FIELDS)[number]

export function isRavenOwnedUserConfigField(key: string): key is RavenOwnedUserConfigField {
  return (RAVEN_OWNED_USER_CONFIG_FIELDS as readonly string[]).includes(key)
}

export function stripRavenOwnedUserConfigFields<T extends Record<string, unknown>>(config: T): Partial<T> {
  if (!isChatermEmbedded()) {
    return config
  }

  const next = { ...config }
  for (const field of RAVEN_OWNED_USER_CONFIG_FIELDS) {
    delete next[field]
  }
  return next
}
