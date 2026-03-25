import { fetchJson, normalizeBaseUrl } from './api'
import { clientsSchema } from './schemas'
import type { Client, SelectedClientIdentity, SelectedClientsPayload } from './types'

export function buildClientsUrl(baseUrl: string): string {
  return new URL('/v2/clients', normalizeBaseUrl(baseUrl)).toString()
}

export function buildSelectedClientsUrl(baseUrl: string): string {
  return new URL('/v2/clients:selected', normalizeBaseUrl(baseUrl)).toString()
}

export async function fetchClients(baseUrl: string): Promise<Client[]> {
  return fetchJson(buildClientsUrl(baseUrl), clientsSchema, 'clients')
}

export function sortClients(clients: Client[]): Client[] {
  return [...clients].sort((left, right) => {
    const seenCompare = right.lastSeenAt.localeCompare(left.lastSeenAt)
    if (seenCompare !== 0) {
      return seenCompare
    }

    const platformCompare = left.platform.localeCompare(right.platform)
    if (platformCompare !== 0) {
      return platformCompare
    }

    const appCompare = left.appId.localeCompare(right.appId)
    if (appCompare !== 0) {
      return appCompare
    }

    const sessionCompare = left.sessionId.localeCompare(right.sessionId)
    if (sessionCompare !== 0) {
      return sessionCompare
    }

    const deviceCompare = left.deviceId.localeCompare(right.deviceId)
    if (deviceCompare !== 0) {
      return deviceCompare
    }

    return left.callbackEndpoint.localeCompare(right.callbackEndpoint)
  })
}

export function clientSelectionKey(client: Pick<Client, 'platform' | 'appId' | 'sessionId' | 'deviceId'>): string {
  return JSON.stringify([client.platform, client.appId, client.sessionId, client.deviceId])
}

export function toSelectedClientIdentity(client: Client): SelectedClientIdentity {
  return {
    platform: client.platform,
    appId: client.appId,
    deviceId: client.deviceId,
    sessionId: client.sessionId,
  }
}

export function buildSelectedClientsPayload(clients: Client[]): SelectedClientsPayload {
  return {
    selected: clients.map(toSelectedClientIdentity),
  }
}

export async function saveSelectedClients(baseUrl: string, clients: Client[]): Promise<void> {
  const response = await fetch(buildSelectedClientsUrl(baseUrl), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildSelectedClientsPayload(clients)),
  })

  if (!response.ok) {
    throw new Error(`PUT ${new URL(buildSelectedClientsUrl(baseUrl)).pathname} failed with HTTP ${response.status}`)
  }
}
