// Copyright (c) 2025-present, chaterm.ai  All rights reserved.
// This source code is licensed under the GPL-3.0
//
// Raven-embedded preload entry point. Built to `out/preload/raven-embedded.js`
// and copied by Raven's build script to `resources/chaterm/preload.js`.
//
// It chains the standard Chaterm preload (`./index`) — which sets up
// `window.electron` and `window.api` — and then exposes Raven's bridges
// (`window.ravenLLM`, `window.ravenUI`, `window.ravenEmbedded`) on top.
//
// Account / edition / auto-update APIs are NOT re-exposed here. Their main-side
// IPC handlers are stubbed in `src/main/embedded/ipc-stubs.ts`, so any calls
// from the renderer through `window.api` return `{ skipped: true }`.

// Side-effect import: sets up window.api + window.electron + ipc listeners.
import './index'
import { contextBridge, ipcRenderer } from 'electron'
import type { AvailableModel, BridgeStreamEvent, CreateMessageAck, CreateMessageRequest } from '../main/agent/shared/raven-bridge-types'
import { isChatermEmbedded } from '../main/config/embedded'

const RAVEN_LLM_LIST = 'raven:llm:listAvailableModels'
const RAVEN_LLM_CREATE = 'raven:llm:createMessage'
const RAVEN_LLM_ABORT = 'raven:llm:abort'
const RAVEN_LLM_STREAM_PREFIX = 'raven:llm:stream:'

const RAVEN_UI_NAVIGATE = 'raven:ui:navigate'
const RAVEN_UI_THEME_CHANGED = 'raven:ui:theme-changed'
const RAVEN_UI_LOCALE_CHANGED = 'raven:ui:locale-changed'

const PRELOAD_LOG_CHANNEL = 'log:write'
const PRELOAD_LOG_MODULE = 'raven-embedded'

export interface RavenLLMApi {
  listAvailableModels(): Promise<AvailableModel[]>
  createMessage(request: CreateMessageRequest): Promise<CreateMessageAck>
  abort(requestId: string): Promise<void>
  /** Returns an unsubscribe function. */
  onStream(requestId: string, listener: (event: BridgeStreamEvent) => void): () => void
}

export interface RavenUIThemePayload {
  theme: 'light' | 'dark' | 'system' | string
}
export interface RavenUILocalePayload {
  locale: string
}
export interface RavenUIApi {
  onThemeChanged(listener: (payload: RavenUIThemePayload) => void): () => void
  onLocaleChanged(listener: (payload: RavenUILocalePayload) => void): () => void
  navigate(path: string): void
}

export interface RavenEmbeddedFlag {
  isEmbedded: true
  source: 'raven'
}

function createRavenLLM(): RavenLLMApi {
  return {
    listAvailableModels: () => ipcRenderer.invoke(RAVEN_LLM_LIST),
    createMessage: (request) => ipcRenderer.invoke(RAVEN_LLM_CREATE, request),
    abort: (requestId) => ipcRenderer.invoke(RAVEN_LLM_ABORT, requestId),
    onStream: (requestId, listener) => {
      const channel = `${RAVEN_LLM_STREAM_PREFIX}${requestId}`
      const handler = (_event: Electron.IpcRendererEvent, payload: BridgeStreamEvent) => {
        listener(payload)
      }
      ipcRenderer.on(channel, handler)
      return () => {
        ipcRenderer.removeListener(channel, handler)
      }
    }
  }
}

function createRavenUI(): RavenUIApi {
  return {
    onThemeChanged: (listener) => {
      const handler = (_e: Electron.IpcRendererEvent, payload: RavenUIThemePayload) => listener(payload)
      ipcRenderer.on(RAVEN_UI_THEME_CHANGED, handler)
      return () => ipcRenderer.removeListener(RAVEN_UI_THEME_CHANGED, handler)
    },
    onLocaleChanged: (listener) => {
      const handler = (_e: Electron.IpcRendererEvent, payload: RavenUILocalePayload) => listener(payload)
      ipcRenderer.on(RAVEN_UI_LOCALE_CHANGED, handler)
      return () => ipcRenderer.removeListener(RAVEN_UI_LOCALE_CHANGED, handler)
    },
    // sendToHost surfaces this as an 'ipc-message' event on the Raven <webview>
    // host (see ChatermWebviewHost onIpcMessage).
    navigate: (path) => ipcRenderer.sendToHost(RAVEN_UI_NAVIGATE, path)
  }
}

function logPreloadError(message: string, meta?: Record<string, unknown>): void {
  void ipcRenderer
    .invoke(PRELOAD_LOG_CHANNEL, {
      level: 'error',
      process: 'preload',
      module: PRELOAD_LOG_MODULE,
      message,
      meta
    })
    .catch(() => {
      // Logging must never block preload initialization.
    })
}

/**
 * Expose Raven bridge APIs on window. Safe to call multiple times — Electron
 * will throw if the same key is registered twice; we swallow that.
 * Only attaches when running embedded (CHATERM_EMBEDDED=1 or --chaterm-embedded=1).
 */
export function exposeRavenEmbeddedApis(): void {
  if (!isChatermEmbedded()) {
    return
  }

  if (!process.contextIsolated) {
    // contextIsolation MUST be enabled per spec §6.3. Refuse to attach onto
    // the window directly — failing closed is safer than wide-open globals.
    logPreloadError('contextIsolation is required but appears disabled')
    return
  }

  const ravenLLM = createRavenLLM()
  const ravenUI = createRavenUI()
  const ravenEmbedded: RavenEmbeddedFlag = { isEmbedded: true, source: 'raven' }

  try {
    contextBridge.exposeInMainWorld('ravenLLM', ravenLLM)
    contextBridge.exposeInMainWorld('ravenUI', ravenUI)
    contextBridge.exposeInMainWorld('ravenEmbedded', ravenEmbedded)
  } catch (error) {
    logPreloadError('contextBridge wiring failed', { error })
  }
}

// Auto-run when this module is loaded as a preload entry point. When imported
// by `index.ts` the same call is harmless because exposeInMainWorld errors are
// caught.
exposeRavenEmbeddedApis()
