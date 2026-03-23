import { normalizeBaseUrl } from './api'
import type { MetricsSnapshot } from './types'

export function buildMetricsUrl(baseUrl: string): string {
  return new URL('/v2/metrics', normalizeBaseUrl(baseUrl)).toString()
}

export async function fetchMetrics(baseUrl: string): Promise<MetricsSnapshot> {
  const response = await fetch(buildMetricsUrl(baseUrl))
  if (!response.ok) {
    throw new Error(`GET /v2/metrics failed with HTTP ${response.status}`)
  }
  return (await response.json()) as MetricsSnapshot
}
