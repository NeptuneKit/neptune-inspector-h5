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
      totalRecords: 99,
      droppedOverflow: 1,
    }

    const response = { ok: true, json: async () => snapshot }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

    await expect(fetchMetrics('http://127.0.0.1:18765')).resolves.toEqual(snapshot)
  })
})
