import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `vi.mock` factories are hoisted, so any shared state must be wrapped in
// `vi.hoisted()` to be available when the factory runs.
const fakeIpc = vi.hoisted(() => {
  const state = {
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    listeners: new Map<string, Array<(...args: unknown[]) => unknown>>(),
    handleCallOrder: [] as string[]
  }
  const mock = {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      if (state.handlers.has(channel)) {
        throw new Error(`Attempted to register a second handler for '${channel}'`)
      }
      state.handlers.set(channel, handler)
      state.handleCallOrder.push(channel)
    },
    removeHandler: (channel: string) => {
      state.handlers.delete(channel)
    },
    on: (channel: string, listener: (...args: unknown[]) => unknown) => {
      const list = state.listeners.get(channel) ?? []
      list.push(listener)
      state.listeners.set(channel, list)
      return mock
    },
    removeListener: (channel: string, listener: (...args: unknown[]) => unknown) => {
      const list = state.listeners.get(channel) ?? []
      const idx = list.indexOf(listener)
      if (idx >= 0) list.splice(idx, 1)
    }
  }
  return { state, mock }
})

const ipcMainState = fakeIpc.state

vi.mock('electron', () => ({
  ipcMain: fakeIpc.mock
}))

// Mock every subsystem the bootstrap calls so we don't pull in better-sqlite3 /
// ssh2 / native modules during a unit test. Each mock registers a known channel
// via `ipcMain.handle` so the test can verify routing.
const SUBSYSTEMS = vi.hoisted(() => ({
  channels: {
    registerSSHHandlers: 'test:ssh',
    registerLocalSSHHandlers: 'test:local-ssh',
    registerRemoteTerminalHandlers: 'test:remote-terminal',
    registerFileSystemHandlers: 'test:fs',
    registerK8sHandlers: 'test:k8s',
    registerDbAssetHandlers: 'test:db-asset',
    registerDbAiHandlers: 'test:db-ai',
    setupPluginIpc: 'test:plugin',
    setupInteractionIpcHandlers: 'test:interaction',
    registerKnowledgeBaseHandlers: 'test:kb',
    registerStageChatAttachmentHandlers: 'test:stage-attach',
    registerPerfIpcHandlers: 'test:perf'
  } as const,
  makeStub(ipc: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => void }, channel: string) {
    return () => {
      ipc.handle(channel, async () => `payload-from-${channel}`)
    }
  }
}))

const SUBSYSTEM_CHANNELS = SUBSYSTEMS.channels

vi.mock('../../ssh/sshHandle', () => ({
  registerSSHHandlers: SUBSYSTEMS.makeStub(fakeIpc.mock as never, SUBSYSTEMS.channels.registerSSHHandlers)
}))
vi.mock('../../ssh/localSSHHandle', () => ({
  registerLocalSSHHandlers: SUBSYSTEMS.makeStub(fakeIpc.mock as never, SUBSYSTEMS.channels.registerLocalSSHHandlers)
}))
vi.mock('../../ssh/agentHandle', () => ({
  registerRemoteTerminalHandlers: SUBSYSTEMS.makeStub(fakeIpc.mock as never, SUBSYSTEMS.channels.registerRemoteTerminalHandlers)
}))
vi.mock('../../ssh/sftpTransfer', () => ({
  registerFileSystemHandlers: SUBSYSTEMS.makeStub(fakeIpc.mock as never, SUBSYSTEMS.channels.registerFileSystemHandlers)
}))
vi.mock('../../k8s/k8sHandle', () => ({
  registerK8sHandlers: SUBSYSTEMS.makeStub(fakeIpc.mock as never, SUBSYSTEMS.channels.registerK8sHandlers)
}))
vi.mock('../../database/dbAssetHandle', () => ({
  registerDbAssetHandlers: SUBSYSTEMS.makeStub(fakeIpc.mock as never, SUBSYSTEMS.channels.registerDbAssetHandlers)
}))
vi.mock('../../database/dbAiHandle', () => ({
  registerDbAiHandlers: SUBSYSTEMS.makeStub(fakeIpc.mock as never, SUBSYSTEMS.channels.registerDbAiHandlers)
}))
vi.mock('../../plugin/pluginIpc', () => ({
  setupPluginIpc: SUBSYSTEMS.makeStub(fakeIpc.mock as never, SUBSYSTEMS.channels.setupPluginIpc)
}))
vi.mock('../../agent/services/interaction-detector/ipc-handlers', () => ({
  setupInteractionIpcHandlers: SUBSYSTEMS.makeStub(fakeIpc.mock as never, SUBSYSTEMS.channels.setupInteractionIpcHandlers)
}))
vi.mock('../../services/knowledgebase', () => ({
  registerKnowledgeBaseHandlers: SUBSYSTEMS.makeStub(fakeIpc.mock as never, SUBSYSTEMS.channels.registerKnowledgeBaseHandlers)
}))
vi.mock('../../services/agent/stageChatAttachment', () => ({
  registerStageChatAttachmentHandlers: SUBSYSTEMS.makeStub(fakeIpc.mock as never, SUBSYSTEMS.channels.registerStageChatAttachmentHandlers)
}))
vi.mock('@perf', () => ({
  registerPerfIpcHandlers: SUBSYSTEMS.makeStub(fakeIpc.mock as never, SUBSYSTEMS.channels.registerPerfIpcHandlers)
}))

// `createLogger` is exposed as an auto-import global by the main-process build;
// stub it for tests that import bootstrap.ts (which calls it at module load).
;(globalThis as Record<string, unknown>).createLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
})

import { bootstrapChatermMain, registerIpcSafe } from '../bootstrap'

beforeEach(() => {
  ipcMainState.handlers.clear()
  ipcMainState.listeners.clear()
  ipcMainState.handleCallOrder = []
})

afterEach(() => {
  vi.clearAllMocks()
})

const ALL_EXPECTED_CHANNELS = Object.values(SUBSYSTEM_CHANNELS)

function makeFakeEvent(senderId: number): { sender: { id: number } } {
  return { sender: { id: senderId } }
}

describe('bootstrapChatermMain', () => {
  it('(a) standalone mode registers every common-subsystem channel without sender validation', async () => {
    const result = await bootstrapChatermMain({ mode: 'standalone' })

    for (const channel of ALL_EXPECTED_CHANNELS) {
      expect(ipcMainState.handlers.has(channel)).toBe(true)
    }
    expect(result.disposers).toHaveLength(ALL_EXPECTED_CHANNELS.length)

    // No validateSender => any sender is permitted.
    const channel = SUBSYSTEM_CHANNELS.registerSSHHandlers
    const handler = ipcMainState.handlers.get(channel)!
    await expect(handler(makeFakeEvent(42))).resolves.toBe(`payload-from-${channel}`)
  })

  it('(b) embedded mode registers every channel and rejects mismatched senders', async () => {
    const ALLOWED_SENDER = 7
    await bootstrapChatermMain({
      mode: 'embedded',
      validateSender: (event) => event.sender.id === ALLOWED_SENDER
    })

    for (const channel of ALL_EXPECTED_CHANNELS) {
      expect(ipcMainState.handlers.has(channel)).toBe(true)
    }

    const channel = SUBSYSTEM_CHANNELS.registerDbAssetHandlers
    const handler = ipcMainState.handlers.get(channel)!
    await expect(handler(makeFakeEvent(ALLOWED_SENDER))).resolves.toBe(`payload-from-${channel}`)
    await expect(handler(makeFakeEvent(999))).rejects.toThrow('E_CHATERM_IPC_FORBIDDEN')
  })

  it('(c) re-mounting after a previous mount does not throw on duplicate channel registration', async () => {
    await bootstrapChatermMain({ mode: 'embedded', validateSender: () => true })
    // Without idempotent registration the second mount throws "Attempted to register a second handler".
    await expect(bootstrapChatermMain({ mode: 'embedded', validateSender: () => true })).resolves.toBeDefined()
    for (const channel of ALL_EXPECTED_CHANNELS) {
      expect(ipcMainState.handlers.has(channel)).toBe(true)
    }
  })

  it('(d) running all disposers leaves the ipcMain handler map empty for those channels', async () => {
    const { disposers } = await bootstrapChatermMain({ mode: 'embedded', validateSender: () => true })
    for (let i = disposers.length - 1; i >= 0; i--) {
      await disposers[i]()
    }
    for (const channel of ALL_EXPECTED_CHANNELS) {
      expect(ipcMainState.handlers.has(channel)).toBe(false)
    }
  })
})

describe('registerIpcSafe', () => {
  it('is idempotent — registering the same channel twice does not throw', () => {
    const dispose1 = registerIpcSafe('test:idem', async () => 'first')
    const dispose2 = registerIpcSafe('test:idem', async () => 'second')
    expect(ipcMainState.handlers.has('test:idem')).toBe(true)
    dispose2()
    dispose1()
    expect(ipcMainState.handlers.has('test:idem')).toBe(false)
  })

  it('rejects when validateSender returns false', async () => {
    registerIpcSafe(
      'test:guarded',
      async () => 'ok',
      (event) => event.sender.id === 1
    )
    const handler = ipcMainState.handlers.get('test:guarded')!
    await expect(handler(makeFakeEvent(1))).resolves.toBe('ok')
    await expect(handler(makeFakeEvent(2))).rejects.toThrow('E_CHATERM_IPC_FORBIDDEN')
  })
})
