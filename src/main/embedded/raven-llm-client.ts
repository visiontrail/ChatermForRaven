import type { RavenLLMClient } from '../agent/api/raven-bridge/types'

let ravenLLMClient: RavenLLMClient | null = null

export function setRavenLLMClient(client: RavenLLMClient | null): void {
  ravenLLMClient = client
}

export function getRavenLLMClient(): RavenLLMClient | null {
  return ravenLLMClient
}
