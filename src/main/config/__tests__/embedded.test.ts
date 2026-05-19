import { afterEach, describe, expect, it } from 'vitest'

import { isChatermEmbedded } from '../embedded'

describe('isChatermEmbedded', () => {
  const originalEnv = process.env.CHATERM_EMBEDDED
  const originalArgv = [...process.argv]

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.CHATERM_EMBEDDED
    } else {
      process.env.CHATERM_EMBEDDED = originalEnv
    }
    process.argv = [...originalArgv]
  })

  it('returns true when CHATERM_EMBEDDED=1', () => {
    process.env.CHATERM_EMBEDDED = '1'
    expect(isChatermEmbedded()).toBe(true)
  })

  it('returns true when --chaterm-embedded=1 is in argv', () => {
    delete process.env.CHATERM_EMBEDDED
    process.argv = [...originalArgv, '--chaterm-embedded=1']
    expect(isChatermEmbedded()).toBe(true)
  })

  it('returns false in standalone mode', () => {
    delete process.env.CHATERM_EMBEDDED
    process.argv = originalArgv.filter((arg) => !arg.includes('chaterm-embedded'))
    expect(isChatermEmbedded()).toBe(false)
  })
})
