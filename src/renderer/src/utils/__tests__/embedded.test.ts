import { describe, expect, it } from 'vitest'

import { isRavenOwnedUserConfigField, stripRavenOwnedUserConfigFields } from '../embedded'

describe('embedded renderer utils', () => {
  it('identifies Raven-owned user config fields', () => {
    expect(isRavenOwnedUserConfigField('language')).toBe(true)
    expect(isRavenOwnedUserConfigField('theme')).toBe(true)
    expect(isRavenOwnedUserConfigField('fontSize')).toBe(false)
  })

  it('stripRavenOwnedUserConfigFields is a no-op when not embedded', () => {
    const input = { language: 'zh-CN', theme: 'dark', fontSize: 14 }
    expect(stripRavenOwnedUserConfigFields(input)).toEqual(input)
  })
})
