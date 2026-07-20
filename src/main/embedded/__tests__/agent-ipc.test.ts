import { beforeEach, describe, expect, it, vi } from 'vitest'

const fakeIpc = vi.hoisted(() => {
  const state = {
    handlers: new Map<string, (...args: unknown[]) => unknown>()
  }
  const mock = {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      if (state.handlers.has(channel)) {
        throw new Error(`Attempted to register a second handler for '${channel}'`)
      }
      state.handlers.set(channel, handler)
    },
    removeHandler: (channel: string) => {
      state.handlers.delete(channel)
    }
  }
  return { state, mock }
})

const controllerMock = vi.hoisted(() => {
  const instances: Array<{
    handleWebviewMessage: ReturnType<typeof vi.fn>
    cancelTask: ReturnType<typeof vi.fn>
    gracefulCancelTask: ReturnType<typeof vi.fn>
    reloadSecurityConfigForAllTasks: ReturnType<typeof vi.fn>
    updateAutoApprovalSettings: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
  }> = []

  const Controller = vi.fn().mockImplementation(function () {
    const instance = {
      handleWebviewMessage: vi.fn().mockResolvedValue(undefined),
      cancelTask: vi.fn().mockResolvedValue(true),
      gracefulCancelTask: vi.fn().mockResolvedValue(true),
      reloadSecurityConfigForAllTasks: vi.fn().mockResolvedValue(undefined),
      updateAutoApprovalSettings: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined)
    }
    instances.push(instance)
    return instance
  })

  return { Controller, instances }
})

const ipcState = fakeIpc.state

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/chaterm-test')
  },
  ipcMain: fakeIpc.mock,
  webContents: {
    fromId: vi.fn()
  }
}))

vi.mock('fs/promises', () => ({
  access: vi.fn(),
  mkdir: vi.fn(),
  readFile: vi.fn().mockResolvedValue('{}'),
  writeFile: vi.fn()
}))

vi.mock('../../agent/core/controller', () => ({
  Controller: controllerMock.Controller
}))

vi.mock('../../agent/core/security/SecurityConfig', () => ({
  SecurityConfigManager: vi.fn().mockImplementation(() => ({
    getConfigPath: vi.fn(() => '/tmp/chaterm-test/security.json'),
    loadConfig: vi.fn().mockResolvedValue(undefined)
  }))
}))

vi.mock('../../config/edition', () => ({
  getUserDataPath: vi.fn(() => '/tmp/chaterm-test')
}))
;(globalThis as Record<string, unknown>).createLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
})

import { registerEmbeddedAgentIpc } from '../agent-ipc'

beforeEach(() => {
  ipcState.handlers.clear()
  controllerMock.instances.length = 0
  vi.clearAllMocks()
})

function makeFakeEvent(senderId: number): { sender: { id: number } } {
  return { sender: { id: senderId } }
}

describe('registerEmbeddedAgentIpc', () => {
  it('routes embedded webview messages through Controller and rejects other senders', async () => {
    registerEmbeddedAgentIpc({
      webContentsId: 7,
      validateSender: (event) => event.sender.id === 7
    })

    const handler = ipcState.handlers.get('webview-to-main')
    expect(handler).toBeDefined()

    const message = { type: 'newTask', text: 'pwd', hosts: [], taskId: 'tab-1', tabId: 'tab-1' }
    await expect(handler!(makeFakeEvent(7), message)).resolves.toBeNull()
    expect(controllerMock.instances[0].handleWebviewMessage).toHaveBeenCalledWith(message)

    await expect(handler!(makeFakeEvent(8), message)).rejects.toThrow('E_CHATERM_IPC_FORBIDDEN')
    expect(controllerMock.instances[0].handleWebviewMessage).toHaveBeenCalledTimes(1)
  })

  it('disposes registered IPC handlers and the Controller', async () => {
    const disposers = registerEmbeddedAgentIpc({
      webContentsId: 7,
      validateSender: () => true
    })

    expect(ipcState.handlers.has('webview-to-main')).toBe(true)

    for (let i = disposers.length - 1; i >= 0; i--) {
      await disposers[i]()
    }

    expect(ipcState.handlers.has('webview-to-main')).toBe(false)
    expect(controllerMock.instances[0].dispose).toHaveBeenCalled()
  })

  it('validates and applies auto approval settings', async () => {
    registerEmbeddedAgentIpc({
      webContentsId: 7,
      validateSender: (event) => event.sender.id === 7
    })

    const handler = ipcState.handlers.get('agent:set-auto-approval-settings')
    const settings = {
      version: 2,
      enabled: false,
      actions: {
        readFiles: true,
        editFiles: false,
        executeSafeCommands: true,
        executeAllCommands: false,
        autoExecuteReadOnlyCommands: true
      },
      maxRequests: 20,
      enableNotifications: false,
      favorites: []
    }

    await expect(handler!(makeFakeEvent(7), settings)).resolves.toEqual({ success: true })
    expect(controllerMock.instances[0].updateAutoApprovalSettings).toHaveBeenCalledWith(settings)
    await expect(handler!(makeFakeEvent(7), { enabled: true })).rejects.toThrow('Invalid auto approval settings')
  })
})
