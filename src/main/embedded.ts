import { webContents } from 'electron'

import type { RavenLLMClient } from './agent/api/raven-bridge/types'
import { isChatermEmbedded } from './config/embedded'
import { registerEmbeddedIpcStubs } from './embedded/ipc-stubs'
import { setMainWindowWebContents } from './storage/db/connection'

const logger = createLogger('embedded')

export interface ChatermEmbedSignals {
  onUnmount?: () => void | Promise<void>
}

/** Minimal bridge surface Raven's LLM service exposes to Chaterm. */
export interface RavenEmbedBridge {
  registerAllowedSender(webContentsId: number): void
}

export interface MountChatermOptions {
  webContentsId: number
  bridge: RavenEmbedBridge
  /** In-process Raven LLM bridge client for Chaterm Agent / DB-AI handlers. */
  llmClient?: RavenLLMClient
  signals?: ChatermEmbedSignals
}

interface MountState {
  webContentsId: number
  bridge: RavenEmbedBridge
  signals?: ChatermEmbedSignals
  disposeIpcStubs: () => void
}

let mountState: MountState | null = null
let ravenLLMClient: RavenLLMClient | null = null

export { isChatermEmbedded } from './config/embedded'

export function setRavenLLMClient(client: RavenLLMClient | null): void {
  ravenLLMClient = client
}

export function getRavenLLMClient(): RavenLLMClient | null {
  return ravenLLMClient
}

export function isChatermMounted(): boolean {
  return mountState !== null
}

export function getEmbeddedWebContentsId(): number | null {
  return mountState?.webContentsId ?? null
}

/**
 * Mount Chaterm main-process services for the Raven-hosted webview.
 * Standalone Chaterm startup (`app.whenReady` in index.ts) is skipped when embedded.
 */
export async function mountChaterm(options: MountChatermOptions): Promise<void> {
  if (mountState) {
    throw new Error('Chaterm is already mounted')
  }

  const wc = webContents.fromId(options.webContentsId)
  if (!wc || wc.isDestroyed()) {
    throw new Error(`Chaterm webview webContents not found: ${options.webContentsId}`)
  }

  options.bridge.registerAllowedSender(options.webContentsId)
  setMainWindowWebContents(wc)

  const stubDisposers = registerEmbeddedIpcStubs()
  const disposeIpcStubs = () => {
    for (const dispose of stubDisposers) {
      dispose()
    }
  }

  if (options.llmClient) {
    setRavenLLMClient(options.llmClient)
  }

  mountState = {
    webContentsId: options.webContentsId,
    bridge: options.bridge,
    signals: options.signals,
    disposeIpcStubs
  }

  logger.info('Chaterm embedded module mounted', { webContentsId: options.webContentsId })
}

/**
 * Tear down embedded Chaterm state. SSH/DB cleanup is expanded in later Raven integration tasks.
 */
export async function unmountChaterm(): Promise<void> {
  if (!mountState) {
    return
  }

  const { signals, disposeIpcStubs, webContentsId } = mountState
  mountState = null

  disposeIpcStubs()
  setMainWindowWebContents(null)
  setRavenLLMClient(null)

  try {
    await signals?.onUnmount?.()
  } catch (error) {
    logger.error('Chaterm embed onUnmount signal failed', { error, webContentsId })
  }

  logger.info('Chaterm embedded module unmounted', { webContentsId })
}
