import { ipcMain } from 'electron'

const EMBEDDED_SKIP = { success: false, skipped: true, reason: 'embedded' as const }

type IpcDispose = () => void

/**
 * Register no-op IPC handlers for features Raven owns in embedded mode.
 * Returns disposers that remove the handlers on unmount.
 */
export function registerEmbeddedIpcStubs(): IpcDispose[] {
  const channels: Array<{ channel: string; handler: (...args: unknown[]) => unknown }> = [
    {
      channel: 'update:checkUpdate',
      handler: async () => ({ updateInfo: null, ...EMBEDDED_SKIP })
    },
    {
      channel: 'update:download',
      handler: async () => EMBEDDED_SKIP
    },
    {
      channel: 'update:quitAndInstall',
      handler: async () => EMBEDDED_SKIP
    },
    {
      channel: 'open-external-login',
      handler: async () => EMBEDDED_SKIP
    },
    {
      channel: 'get-protocol-prefix',
      handler: async () => 'raven-chaterm://'
    }
  ]

  for (const { channel, handler } of channels) {
    ipcMain.handle(channel, handler)
  }

  return channels.map(({ channel }) => () => {
    ipcMain.removeHandler(channel)
  })
}
