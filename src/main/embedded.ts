import { webContents } from 'electron'

import type { RavenLLMClient } from './agent/api/raven-bridge/types'
import { bootstrapChatermMain, type BootstrapDisposer, type BootstrapResult } from './embedded/bootstrap'
import { registerEmbeddedIpcStubs } from './embedded/ipc-stubs'
import { setRavenLLMClient as setEmbeddedRavenLLMClient } from './embedded/raven-llm-client'
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
  bootstrapDisposers: BootstrapDisposer[]
}

let mountState: MountState | null = null

export { isChatermEmbedded } from './config/embedded'
export { getRavenLLMClient, setRavenLLMClient } from './embedded/raven-llm-client'

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
    setEmbeddedRavenLLMClient(options.llmClient)
  }

  let bootstrapResult: BootstrapResult
  try {
    bootstrapResult = await bootstrapChatermMain({
      mode: 'embedded',
      webContentsId: options.webContentsId,
      validateSender: (event) => event.sender.id === options.webContentsId
    })
  } catch (error) {
    // Roll back the partial mount state if bootstrap fails.
    disposeIpcStubs()
    setMainWindowWebContents(null)
    setEmbeddedRavenLLMClient(null)
    throw error
  }

  mountState = {
    webContentsId: options.webContentsId,
    bridge: options.bridge,
    signals: options.signals,
    disposeIpcStubs,
    bootstrapDisposers: bootstrapResult.disposers
  }

  logger.info('Chaterm embedded module mounted', {
    webContentsId: options.webContentsId,
    bootstrapDisposers: bootstrapResult.disposers.length
  })
}

/**
 * Tear down embedded Chaterm state. SSH/DB cleanup is expanded in later Raven integration tasks.
 */
export async function unmountChaterm(): Promise<void> {
  if (!mountState) {
    return
  }

  const { signals, disposeIpcStubs, webContentsId, bootstrapDisposers } = mountState
  mountState = null

  // Reverse-order disposal: bootstrap subsystem handlers first, then stubs,
  // then shared singletons. Each step is wrapped so a single failure does not
  // skip the remaining cleanup.
  for (let i = bootstrapDisposers.length - 1; i >= 0; i--) {
    try {
      await bootstrapDisposers[i]()
    } catch (error) {
      logger.warn('Chaterm bootstrap disposer failed', { error, webContentsId, index: i })
    }
  }

  try {
    disposeIpcStubs()
  } catch (error) {
    logger.warn('Chaterm embed disposeIpcStubs failed', { error, webContentsId })
  }

  setMainWindowWebContents(null)
  setEmbeddedRavenLLMClient(null)

  try {
    await signals?.onUnmount?.()
  } catch (error) {
    logger.error('Chaterm embed onUnmount signal failed', { error, webContentsId })
  }

  logger.info('Chaterm embedded module unmounted', { webContentsId })
}
