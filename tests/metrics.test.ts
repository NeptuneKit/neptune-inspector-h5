import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildMetricsUrl, fetchMetrics } from '../src/metrics'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('metrics helpers', () => {
  it('builds the metrics endpoint url', () => {
    expect(buildMetricsUrl('http://127.0.0.1:18765/')).toBe('http://127.0.0.1:18765/v2/metrics')
  })

  it('fetches the metrics snapshot', async () => {
    const snapshot = {
      ingestAcceptedTotal: 12,
      sourceCount: 3,
      retainedRecordCount: 0,
      retentionMaxRecordCount: 0,
      retentionMaxAgeSeconds: 0,
      retentionDroppedTotal: 0,
    }

    const response = { ok: true, json: async () => snapshot }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

    await expect(fetchMetrics('http://127.0.0.1:18765')).resolves.toEqual(snapshot)
  })

  it('rejects malformed metrics payloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ingestAcceptedTotal: '12',
        sourceCount: 3,
        retainedRecordCount: 0,
        retentionMaxRecordCount: 0,
        retentionMaxAgeSeconds: 0,
        retentionDroppedTotal: 0,
      }),
    }))

    await expect(fetchMetrics('http://127.0.0.1:18765')).rejects.toThrow(/Invalid metrics payload/)
  })
})
