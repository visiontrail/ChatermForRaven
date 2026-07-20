import { app, ipcMain, webContents, type IpcMainInvokeEvent } from 'electron'
import { access, mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'

import { Controller } from '../agent/core/controller'
import { SecurityConfigManager } from '../agent/core/security/SecurityConfig'
import type { ExtensionMessage } from '../agent/shared/ExtensionMessage'
import type { WebviewMessage } from '../agent/shared/WebviewMessage'
import { isAutoApprovalSettings } from '../agent/shared/AgentPermissionMode'
import { getUserDataPath } from '../config/edition'
import type { BootstrapDisposer } from './bootstrap'

const logger = createLogger('embedded/agent-ipc')
const FORBIDDEN_ERROR = 'E_CHATERM_IPC_FORBIDDEN'

export interface EmbeddedAgentIpcOptions {
  webContentsId: number
  validateSender?: (event: IpcMainInvokeEvent) => boolean
}

async function ensureMcpConfigFileExists(): Promise<string> {
  const configDir = path.join(app.getPath('userData'), 'setting')
  const configPath = path.join(configDir, 'mcp_settings.json')

  await mkdir(configDir, { recursive: true })
  try {
    await access(configPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
    await writeFile(configPath, JSON.stringify({ mcpServers: {} }, null, 2), 'utf-8')
    logger.info('[MCP] Created default embedded configuration file')
  }

  return configPath
}

function getKeywordHighlightFallbackConfig(): string {
  return JSON.stringify(
    {
      'keyword-highlight': {
        enabled: true,
        applyTo: {
          output: true,
          input: false
        },
        rules: []
      }
    },
    null,
    2
  )
}

async function ensureKeywordHighlightConfigFile(): Promise<string> {
  const configPath = path.join(getUserDataPath(), 'keyword-highlight.json')
  try {
    await access(configPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
    await writeFile(configPath, getKeywordHighlightFallbackConfig(), 'utf-8')
    logger.info('[KeywordHighlight] Created default embedded configuration file')
  }
  return configPath
}

function registerIpc<TArgs extends unknown[]>(
  disposers: BootstrapDisposer[],
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: TArgs) => unknown,
  validateSender?: (event: IpcMainInvokeEvent) => boolean
): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (validateSender && !validateSender(event)) {
      logger.warn('ipc.sender.rejected', { channel, senderId: event.sender.id })
      throw new Error(FORBIDDEN_ERROR)
    }
    return handler(event, ...(args as TArgs))
  })
  disposers.push(() => ipcMain.removeHandler(channel))
}

function sendToEmbeddedWebview(webContentsId: number, channel: string, payload: unknown): Promise<boolean> {
  const wc = webContents.fromId(webContentsId)
  if (!wc || wc.isDestroyed()) {
    return Promise.resolve(false)
  }
  wc.send(channel, payload)
  return Promise.resolve(true)
}

function createMessageSender(webContentsId: number): (message: ExtensionMessage) => Promise<boolean> {
  return async (message) => {
    const msg = message

    if (msg.type === 'commandGenerationResponse') {
      return sendToEmbeddedWebview(webContentsId, 'command-generation-response', {
        command: msg.command,
        error: msg.error,
        tabId: msg.tabId
      })
    }

    if (msg.type === 'explainCommandResponse') {
      return sendToEmbeddedWebview(webContentsId, 'command-explain-response', {
        explanation: msg.explanation,
        error: msg.error,
        tabId: msg.tabId,
        commandMessageId: msg.commandMessageId
      })
    }

    if (msg.type === 'mcpServersUpdate') {
      return sendToEmbeddedWebview(webContentsId, 'mcp:status-update', msg.mcpServers)
    }

    if (msg.type === 'mcpServerUpdate') {
      return sendToEmbeddedWebview(webContentsId, 'mcp:server-update', msg.mcpServer)
    }

    if (msg.type === 'mcpConfigFileChanged') {
      return sendToEmbeddedWebview(webContentsId, 'mcp:config-file-changed', msg.content)
    }

    return sendToEmbeddedWebview(webContentsId, 'main-to-webview', msg)
  }
}

export function registerEmbeddedAgentIpc(opts: EmbeddedAgentIpcOptions): BootstrapDisposer[] {
  const disposers: BootstrapDisposer[] = []
  const controller = new Controller(createMessageSender(opts.webContentsId), ensureMcpConfigFileExists)

  registerIpc(
    disposers,
    'webview-to-main',
    async (_event, message: WebviewMessage): Promise<void | null> => {
      await controller.handleWebviewMessage(message)
      return null
    },
    opts.validateSender
  )

  registerIpc(
    disposers,
    'cancel-task',
    async (_event, payload?: { tabId?: string }) => {
      return controller.cancelTask(payload?.tabId)
    },
    opts.validateSender
  )

  registerIpc(
    disposers,
    'graceful-cancel-task',
    async (_event, payload?: { tabId?: string }) => {
      return controller.gracefulCancelTask(payload?.tabId)
    },
    opts.validateSender
  )

  registerIpc(
    disposers,
    'agent:set-auto-approval-settings',
    async (_event, settings: unknown) => {
      if (!isAutoApprovalSettings(settings)) {
        throw new Error('Invalid auto approval settings')
      }
      await controller.updateAutoApprovalSettings(settings)
      return { success: true }
    },
    opts.validateSender
  )

  registerIpc(disposers, 'mcp:get-config-path', async () => ensureMcpConfigFileExists(), opts.validateSender)

  registerIpc(
    disposers,
    'security-get-config-path',
    async () => {
      return new SecurityConfigManager().getConfigPath()
    },
    opts.validateSender
  )

  registerIpc(
    disposers,
    'security-read-config',
    async () => {
      const securityManager = new SecurityConfigManager()
      const configPath = securityManager.getConfigPath()
      try {
        await access(configPath)
      } catch {
        await securityManager.loadConfig()
      }
      return readFile(configPath, 'utf-8')
    },
    opts.validateSender
  )

  registerIpc(
    disposers,
    'security-write-config',
    async (_event, content: string) => {
      const securityManager = new SecurityConfigManager()
      await writeFile(securityManager.getConfigPath(), content, 'utf-8')
      await securityManager.loadConfig()
      await controller.reloadSecurityConfigForAllTasks()
      return { success: true }
    },
    opts.validateSender
  )

  registerIpc(
    disposers,
    'keyword-highlight-get-config-path',
    async () => {
      return path.join(getUserDataPath(), 'keyword-highlight.json')
    },
    opts.validateSender
  )

  registerIpc(
    disposers,
    'keyword-highlight-read-config',
    async () => {
      const configPath = await ensureKeywordHighlightConfigFile()
      return readFile(configPath, 'utf-8')
    },
    opts.validateSender
  )

  registerIpc(
    disposers,
    'keyword-highlight-write-config',
    async (_event, content: string) => {
      const configPath = path.join(getUserDataPath(), 'keyword-highlight.json')
      await writeFile(configPath, content, 'utf-8')
      return { success: true }
    },
    opts.validateSender
  )

  disposers.push(async () => {
    await controller.dispose()
  })

  return disposers
}
