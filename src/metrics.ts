import { fetchJson, normalizeBaseUrl } from './api'
import { metricsSnapshotSchema } from './schemas'
import type { MetricsSnapshot } from './types'

export function buildMetricsUrl(baseUrl: string): string {
  return new URL('/v2/metrics', normalizeBaseUrl(baseUrl)).toString()
}

export async function fetchMetrics(baseUrl: string): Promise<MetricsSnapshot> {
  return fetchJson(buildMetricsUrl(baseUrl), metricsSnapshotSchema, 'metrics')
}
