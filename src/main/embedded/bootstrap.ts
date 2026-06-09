import { ipcMain, type IpcMainInvokeEvent } from 'electron'

import { registerDbAiHandlers } from '../database/dbAiHandle'
import { registerDbAssetHandlers } from '../database/dbAssetHandle'
import { registerK8sHandlers } from '../k8s/k8sHandle'
import { setupPluginIpc } from '../plugin/pluginIpc'
import { setupInteractionIpcHandlers } from '../agent/services/interaction-detector/ipc-handlers'
import { registerStageChatAttachmentHandlers } from '../services/agent/stageChatAttachment'
import { registerKnowledgeBaseHandlers } from '../services/knowledgebase'
import { registerPerfIpcHandlers } from '@perf'
import { registerRemoteTerminalHandlers } from '../ssh/agentHandle'
import { registerLocalSSHHandlers } from '../ssh/localSSHHandle'
import { registerFileSystemHandlers } from '../ssh/sftpTransfer'
import { registerSSHHandlers } from '../ssh/sshHandle'
import { registerEmbeddedStorageHandlers } from './storage-ipc'

const logger = createLogger('embedded/bootstrap')

export type BootstrapMode = 'standalone' | 'embedded'

export interface BootstrapOptions {
  mode: BootstrapMode
  webContentsId?: number
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

interface TrackedRegistration {
  type: 'handle' | 'on'
  channel: string
  listener?: (...args: unknown[]) => void
}

/**
 * Monkey-patch `ipcMain.handle` and `ipcMain.on` for the duration of `register`
 * so each registration is (a) recorded for later disposal, (b) idempotent
 * (removes prior handler first), and (c) wrapped with `validateSender` when
 * the bootstrap mode requires it.
 *
 * This retrofits dispose support onto Chaterm's existing setup functions
 * (`registerSSHHandlers`, `registerK8sHandlers`, ...) without modifying their
 * internals — they keep calling `ipcMain.handle` directly, but during this
 * scope those calls are intercepted.
 *
 * Limitations: only synchronous `ipcMain.handle/on` calls made *during*
 * `register()` are tracked. Late-bound dynamic registrations (e.g. the
 * per-connection `ssh:keyboard-interactive-response:${connectionId}` registered
 * inside another handler) are NOT tracked here; they self-clean via `once()`.
 */
function withTrackedRegistrations(opts: BootstrapOptions, register: () => void): BootstrapDisposer[] {
  const tracked: TrackedRegistration[] = []
  const originalHandle = ipcMain.handle.bind(ipcMain)
  const originalOn = ipcMain.on.bind(ipcMain)
  const originalRemoveHandler = ipcMain.removeHandler.bind(ipcMain)

  const patchedHandle = (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
    originalRemoveHandler(channel)
    const wrapped = async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<unknown> => {
      if (opts.validateSender && !opts.validateSender(event)) {
        logger.warn('ipc.sender.rejected', { channel, senderId: event.sender.id })
        throw new Error(FORBIDDEN_ERROR)
      }
      return handler(event, ...args)
    }
    originalHandle(channel, wrapped)
    tracked.push({ type: 'handle', channel })
  }

  const patchedOn = (channel: string, listener: (...args: unknown[]) => void) => {
    let effectiveListener = listener
    if (opts.validateSender) {
      effectiveListener = (event: unknown, ...args: unknown[]) => {
        const ev = event as { sender?: { id: number } }
        if (ev?.sender && !opts.validateSender!(event as IpcMainInvokeEvent)) {
          logger.warn('ipc.sender.rejected', { channel, senderId: ev.sender.id })
          return
        }
        return listener(event, ...args)
      }
    }
    originalOn(channel, effectiveListener as never)
    tracked.push({ type: 'on', channel, listener: effectiveListener })
    return ipcMain
  }

  ;(ipcMain as unknown as { handle: typeof patchedHandle }).handle = patchedHandle
  ;(ipcMain as unknown as { on: typeof patchedOn }).on = patchedOn

  try {
    register()
  } finally {
    ;(ipcMain as unknown as { handle: typeof originalHandle }).handle = originalHandle
    ;(ipcMain as unknown as { on: typeof originalOn }).on = originalOn
  }

  return tracked.map((entry) => {
    if (entry.type === 'handle') {
      return () => ipcMain.removeHandler(entry.channel)
    }
    return () => {
      if (entry.listener) {
        ipcMain.removeListener(entry.channel, entry.listener as never)
      }
    }
  })
}

/**
 * Register the IPC-pure subsystems that don't need a BrowserWindow:
 *   - SSH / Local SSH / Remote Terminal / SFTP file-system
 *   - K8s
 *   - Database asset / Database AI
 *   - Plugin IPC
 *   - Interaction detector
 *   - Knowledge base & stage chat attachment
 *   - Perf metrics
 *
 * All registrations are tracked + wrapped with sender validation per `opts`.
 *
 * Subsystems that depend on `mainWindow` / `controller` / `dataSyncController`
 * (e.g. `setupIPC()`, `initializeStorageMain`, `registerUpdater`) remain in the
 * standalone `app.whenReady` path until a follow-up change can decouple them
 * from `BrowserWindow`.
 */
function registerCommonSubsystems(opts: BootstrapOptions): BootstrapDisposer[] {
  return withTrackedRegistrations(opts, () => {
    registerKnowledgeBaseHandlers()
    registerStageChatAttachmentHandlers()
    registerPerfIpcHandlers()
    registerEmbeddedStorageHandlers()
    registerSSHHandlers()
    registerLocalSSHHandlers()
    registerRemoteTerminalHandlers()
    registerFileSystemHandlers()
    setupPluginIpc()
    registerK8sHandlers()
    registerDbAssetHandlers()
    registerDbAiHandlers()
    setupInteractionIpcHandlers()
  })
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
 * Scope note (§1.5 of `wire-chaterm-embedded-runtime`): this currently
 * migrates only the IPC-pure subsystems (no BrowserWindow / Controller
 * dependency). Module-top-level `ipcMain.handle` calls in `index.ts` and
 * BrowserWindow-bound setup (`setupIPC()`, `initializeStorageMain`,
 * `registerUpdater`, Controller wiring) are still registered out-of-band by
 * `whenReady` (standalone) or are missing in embedded mode pending the
 * deeper refactor.
 */
export async function bootstrapChatermMain(opts: BootstrapOptions): Promise<BootstrapResult> {
  logger.info('bootstrap.start', { mode: opts.mode, hasValidateSender: !!opts.validateSender })

  const disposers: BootstrapDisposer[] = []
  disposers.push(...registerCommonSubsystems(opts))
  if (opts.mode === 'embedded') {
    if (typeof opts.webContentsId !== 'number') {
      throw new Error('webContentsId is required for embedded Chaterm bootstrap')
    }
    const { registerEmbeddedAgentIpc } = await import('./agent-ipc')
    disposers.push(
      ...registerEmbeddedAgentIpc({
        webContentsId: opts.webContentsId,
        validateSender: opts.validateSender
      })
    )
  }

  logger.info('bootstrap.done', { mode: opts.mode, disposerCount: disposers.length })
  return { disposers }
}
