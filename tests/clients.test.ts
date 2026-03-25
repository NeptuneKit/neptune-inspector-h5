import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildClientsUrl, fetchClients, saveSelectedClients, sortClients } from '../src/clients'
import type { Client } from '../src/types'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('clients helpers', () => {
  it('builds the clients endpoint url', () => {
    expect(buildClientsUrl('http://127.0.0.1:18765/')).toBe('http://127.0.0.1:18765/v2/clients')
  })

  it('fetches clients as a snapshot array', async () => {
    const clients = [sampleClient('ios', 'demo.app', 'session-1', 'device-1', 'https://callback.example/ping', '2026-03-24T00:00:00.000Z', 30)]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => clients,
    }))

    await expect(fetchClients('http://127.0.0.1:18765')).resolves.toEqual(clients)
  })

  it('sorts clients by last seen time and identity', () => {
    const clients = sortClients([
      sampleClient('ios', 'b.app', 'session-b', 'device-b', 'https://callback.example/b', '2026-03-23T23:00:00.000Z', 30),
      sampleClient('ios', 'a.app', 'session-a', 'device-a', 'https://callback.example/a', '2026-03-23T23:01:00.000Z', 30),
      sampleClient('android', 'a.app', 'session-c', 'device-c', 'https://callback.example/c', '2026-03-23T23:01:00.000Z', 30),
    ])

    expect(clients.map((item) => item.deviceId)).toEqual(['device-c', 'device-a', 'device-b'])
  })

  it('sends a full overwrite payload for selected clients', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchSpy)

    const selected = [
      sampleClient('ios', 'demo.app', 'session-1', 'device-1', 'https://callback.example/one', '2026-03-24T00:00:00.000Z', 30),
      sampleClient('android', 'demo.app', 'session-2', 'device-2', 'https://callback.example/two', '2026-03-24T00:01:00.000Z', 45),
    ]

    await saveSelectedClients('http://127.0.0.1:18765', selected)

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:18765/v2/clients:selected',
      expect.objectContaining({
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    )

    const requestInit = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined
    expect(requestInit?.body).toBe(JSON.stringify({
      selected: [
        {
          platform: 'ios',
          appId: 'demo.app',
          deviceId: 'device-1',
          sessionId: 'session-1',
        },
        {
          platform: 'android',
          appId: 'demo.app',
          deviceId: 'device-2',
          sessionId: 'session-2',
        },
      ],
    }))
  })
})

function sampleClient(
  platform: Client['platform'],
  appId: string,
  sessionId: string,
  deviceId: string,
  callbackEndpoint: string,
  lastSeenAt: string,
  ttlSeconds: number,
): Client {
  return {
    platform,
    appId,
    sessionId,
    deviceId,
    callbackEndpoint,
    lastSeenAt,
    ttlSeconds,
    sdkName: 'NeptuneKit',
    sdkVersion: '1.0.0',
  }
}
