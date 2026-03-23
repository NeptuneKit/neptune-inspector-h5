import { fetchJson, normalizeBaseUrl } from './api'
import { logPageSchema } from './schemas'
import type { LogPage, LogQueryFilters, LogRecord } from './types'

export const DEFAULT_LIMIT = 100
export const DEFAULT_WAIT_MS = 1500

export function buildLogsUrl(baseUrl: string, options: { afterId?: string | null; waitMs?: number; limit?: number } = {}): string {
  const url = new URL('/v2/logs', normalizeBaseUrl(baseUrl))
  if (options.afterId) {
    url.searchParams.set('afterId', options.afterId)
  }
  url.searchParams.set('waitMs', String(options.waitMs ?? DEFAULT_WAIT_MS))
  url.searchParams.set('limit', String(options.limit ?? DEFAULT_LIMIT))
  url.searchParams.set('format', 'json')
  return url.toString()
}

export async function fetchLogPage(baseUrl: string, options: { afterId?: string | null; waitMs?: number; limit?: number } = {}): Promise<LogPage> {
  return fetchJson(buildLogsUrl(baseUrl, options), logPageSchema, 'logs')
}

export function filterRecords(records: LogRecord[], filters: LogQueryFilters): LogRecord[] {
  return records.filter((record) => {
    if (filters.platform && !record.platform.includes(filters.platform.trim())) {
      return false
    }
    if (filters.appId && !record.appId.includes(filters.appId.trim())) {
      return false
    }
    if (filters.sessionId && !record.sessionId.includes(filters.sessionId.trim())) {
      return false
    }
    if (filters.level && !record.level.includes(filters.level.trim())) {
      return false
    }
    return true
  })
}

export function mergeRecords(existing: LogRecord[], incoming: LogRecord[]): LogRecord[] {
  const seen = new Map<number, LogRecord>()
  for (const record of existing) {
    seen.set(record.id, record)
  }
  for (const record of incoming) {
    seen.set(record.id, record)
  }
  return Array.from(seen.values()).sort((left, right) => left.id - right.id)
}

export async function pollLogPage(baseUrl: string, afterId: string | null, waitMs: number): Promise<LogPage> {
  return fetchLogPage(baseUrl, { afterId, waitMs })
}
