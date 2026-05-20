// Copyright (c) 2025-present, chaterm.ai  All rights reserved.
// This source code is licensed under the GPL-3.0
//
// Ambient typings for the APIs exposed by `raven-embedded.ts`. Picked up by
// `tsconfig.web.json` (which includes `src/preload/*.d.ts`) so the Chaterm
// renderer can consume `window.ravenLLM` / `window.ravenUI` /
// `window.ravenEmbedded` in strict mode.

import type { AvailableModel, BridgeStreamEvent, CreateMessageAck, CreateMessageRequest } from '../main/agent/shared/raven-bridge-types'

export interface RavenLLMApi {
  listAvailableModels(): Promise<AvailableModel[]>
  createMessage(request: CreateMessageRequest): Promise<CreateMessageAck>
  abort(requestId: string): Promise<void>
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

declare global {
  interface Window {
    ravenLLM?: RavenLLMApi
    ravenUI?: RavenUIApi
    ravenEmbedded?: RavenEmbeddedFlag
  }
}
