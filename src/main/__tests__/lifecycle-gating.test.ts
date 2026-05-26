import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Regression guard for D10: in embedded mode, Raven owns the Electron lifecycle
 * and drives cleanup via ChatermProcessService.destroy() -> unmountChaterm().
 * Chaterm MUST NOT register its own lifecycle listeners at module load when
 * isChatermEmbedded() is true, or shared resources (SSH/sqlite/sync workers)
 * will be torn down twice and race.
 *
 * A full app.listenerCount('before-quit') assertion requires mocking the entire
 * Electron environment plus every top-level dependency in index.ts (controllers,
 * sqlite native modules, autoUpdater, BrowserWindow, ...). The gating logic is
 * a top-level if-statement, so a source-level check catches the same regression
 * class without paying that mocking cost.
 */
describe('Chaterm main lifecycle gating', () => {
  const source = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8')

  const gatedLifecycleEvents = ['before-quit', 'window-all-closed', 'open-url', 'second-instance']

  for (const event of gatedLifecycleEvents) {
    it(`gates app.on('${event}', ...) behind !isChatermEmbedded()`, () => {
      const pattern = new RegExp(`app\\.on\\(['"\`]${event}['"\`]`, 'g')
      const matches = [...source.matchAll(pattern)]
      expect(matches.length, `expected at least one app.on('${event}') registration in index.ts`).toBeGreaterThan(0)

      const negativeGatePattern = /if \(!isChatermEmbedded\(\)/g
      const positiveGatePattern = /if \(isChatermEmbedded\(\)/g

      for (const match of matches) {
        const offset = match.index ?? 0
        const prefix = source.slice(0, offset)
        const negativeMatches = [...prefix.matchAll(negativeGatePattern)]
        const positiveMatches = [...prefix.matchAll(positiveGatePattern)]
        const lastNegative = negativeMatches.length > 0 ? (negativeMatches[negativeMatches.length - 1].index ?? -1) : -1
        const lastPositive = positiveMatches.length > 0 ? (positiveMatches[positiveMatches.length - 1].index ?? -1) : -1
        expect(lastNegative, `app.on('${event}') at offset ${offset} is not wrapped by a preceding "if (!isChatermEmbedded()" gate`).toBeGreaterThan(
          -1
        )
        expect(
          lastNegative,
          `app.on('${event}') sits inside an "if (isChatermEmbedded()" branch instead of behind the negative gate`
        ).toBeGreaterThan(lastPositive)
      }
    })
  }
})
