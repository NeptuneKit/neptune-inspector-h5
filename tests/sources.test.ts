import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSourcesUrl, fetchSources, sortSources } from '../src/sources'
import type { Source } from '../src/types'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sources helpers', () => {
  it('builds the sources endpoint url', () => {
    expect(buildSourcesUrl('http://127.0.0.1:18765/')).toBe('http://127.0.0.1:18765/v2/sources')
  })

  it('sorts sources by last seen time and identity', () => {
    const sources = sortSources([
      sampleSource('ios', 'b.app', 'session-b', 'device-b', '2026-03-23T23:00:00.000Z'),
      sampleSource('ios', 'a.app', 'session-a', 'device-a', '2026-03-23T23:01:00.000Z'),
      sampleSource('android', 'a.app', 'session-c', 'device-c', '2026-03-23T23:01:00.000Z'),
    ])

    expect(sources.map((item) => item.deviceId)).toEqual(['device-c', 'device-a', 'device-b'])
  })

  it('fetches sources as a snapshot array', async () => {
    const response = { ok: true, json: async () => [sampleSource('web', 'demo.app', 'session-1', 'device-1', '2026-03-23T23:02:00.000Z')] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

    await expect(fetchSources('http://127.0.0.1:18765')).resolves.toHaveLength(1)
  })

  it('rejects malformed source payloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([{
        platform: 'web',
        appId: 'demo.app',
        sessionId: 'session-1',
        deviceId: 'device-1',
        lastSeenAt: 42,
      }]),
    }))

    await expect(fetchSources('http://127.0.0.1:18765')).rejects.toThrow(/Invalid sources payload/)
  })
})

function sampleSource(
  platform: Source['platform'],
  appId: string,
  sessionId: string,
  deviceId: string,
  lastSeenAt: string,
): Source {
  return {
    platform,
    appId,
    sessionId,
    deviceId,
    lastSeenAt,
    sdkName: 'NeptuneKit',
    sdkVersion: '1.0.0',
    status: 'online',
  }
}
