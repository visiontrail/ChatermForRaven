import { ipcMain, type IpcMainInvokeEvent } from 'electron'

const logger = createLogger('embedded/bootstrap')

export type BootstrapMode = 'standalone' | 'embedded'

export interface BootstrapOptions {
  mode: BootstrapMode
  /**
   * In embedded mode, called with the IpcMainInvokeEvent for every wrapped
   * handler. Must return true to allow the invocation to proceed. When false,
   * the handler rejects with `E_CHATERM_IPC_FORBIDDEN`.
   *
   * In standalone mode, this is typically undefined and all senders are allowed.
   */
  validateSender?: (event: IpcMainInvokeEvent) => boolean
}

export type BootstrapDisposer = () => void | Promise<void>

export interface BootstrapResult {
  disposers: BootstrapDisposer[]
}

const FORBIDDEN_ERROR = 'E_CHATERM_IPC_FORBIDDEN'

/**
 * Register an `ipcMain.handle` channel idempotently. Removes any prior handler
 * for the channel first, then registers a wrapped handler that performs sender
 * validation when provided. Returns a disposer that removes the handler.
 *
 * The idempotent removeHandler-then-handle pattern lets `mountChaterm()` be
 * safely re-invoked after a renderer crash without producing the
 * "Attempted to register a second handler" error.
 */
export function registerIpcSafe(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
  validateSender?: (event: IpcMainInvokeEvent) => boolean
): BootstrapDisposer {
  ipcMain.removeHandler(channel)

  const wrapped = async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<unknown> => {
    if (validateSender && !validateSender(event)) {
      logger.warn('ipc.sender.rejected', {
        channel,
        senderId: event.sender.id
      })
      throw new Error(FORBIDDEN_ERROR)
    }
    return handler(event, ...args)
  }

  ipcMain.handle(channel, wrapped)

  return () => {
    ipcMain.removeHandler(channel)
  }
}

/**
 * Bootstrap Chaterm's main-process IPC layer.
 *
 * Standalone mode: invoked from `app.whenReady` in `src/main/index.ts`; all
 * subsystem registrations run with no sender validation.
 *
 * Embedded mode: invoked by `mountChaterm()` once Raven knows the Chaterm
 * webview's webContentsId; `validateSender` enforces that only that webview
 * can invoke Chaterm-internal channels.
 *
 * NOTE: This is a signature-only skeleton. Subsystem registration logic
 * (DB / Agent / SSH / SFTP / PTY / KV / etc.) is migrated out of
 * `src/main/index.ts` in tasks §1.5; until then `disposers` is empty.
 */
export async function bootstrapChatermMain(opts: BootstrapOptions): Promise<BootstrapResult> {
  logger.info('bootstrap.start', { mode: opts.mode, hasValidateSender: !!opts.validateSender })

  const disposers: BootstrapDisposer[] = []

  // Subsystem registrations land here in §1.5:
  //   disposers.push(...registerDbHandlers(opts))
  //   disposers.push(...registerKvHandlers(opts))
  //   disposers.push(...registerSshHandlers(opts))
  //   disposers.push(...registerSftpHandlers(opts))
  //   disposers.push(...registerPtyHandlers(opts))
  //   disposers.push(...registerAgentHandlers(opts))
  //   disposers.push(...registerDbAiHandlers(opts))
  //   disposers.push(...registerEncryptionHandlers(opts))
  //   disposers.push(...registerKeywordHighlightHandlers(opts))
  //   disposers.push(...registerShortcutHandlers(opts))
  //   disposers.push(...registerTtsHandlers(opts))
  //   disposers.push(...registerAutocompleteHandlers(opts))
  //   disposers.push(...registerFileHandlers(opts))

  logger.info('bootstrap.done', { mode: opts.mode, disposerCount: disposers.length })
  return { disposers }
}
