/**
 * Embedded-mode detection for Chaterm running inside Raven.
 *
 * Raven sets `CHATERM_EMBEDDED=1` before loading the Chaterm main module and passes
 * `--chaterm-embedded=1` to the Chaterm webview via additionalArguments.
 */
export function isChatermEmbedded(): boolean {
  const env = process.env.CHATERM_EMBEDDED
  if (env === '1' || env === 'true') {
    return true
  }

  return process.argv.some((arg) => arg === '--chaterm-embedded=1' || arg === '--chaterm-embedded')
}
