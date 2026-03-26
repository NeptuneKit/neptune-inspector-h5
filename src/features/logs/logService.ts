import { fetchJson, normalizeBaseUrl } from '../../api'
import { logPageSchema } from '../../schemas'
import type { LogRecord } from '../../types'
import type { ClientIdentity } from '../clients/clientKey'
import { matchRecordToClient } from './logMatch'

export function mergeLogRecords(existing: LogRecord[], incoming: LogRecord[]): LogRecord[] {
  const map = new Map<number, LogRecord>()
  for (const record of existing) {
    map.set(record.id, record)
  }
  for (const record of incoming) {
    map.set(record.id, record)
  }

  return Array.from(map.values()).sort((left, right) => left.id - right.id)
}

export function buildClientLogsUrl(
  baseUrl: string,
  identity: ClientIdentity,
  options: { afterId?: string | null; waitMs?: number; limit?: number } = {},
): string {
  const url = new URL('/v2/logs', normalizeBaseUrl(baseUrl))
  url.searchParams.set('platform', identity.platform)
  url.searchParams.set('appId', identity.appId)
  url.searchParams.set('sessionId', identity.sessionId)
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', String(options.limit ?? 100))
  if (options.afterId) {
    url.searchParams.set('afterId', options.afterId)
  }
  if (typeof options.waitMs === 'number') {
    url.searchParams.set('waitMs', String(options.waitMs))
  }

  return url.toString()
}

export async function fetchClientLogs(
  baseUrl: string,
  identity: ClientIdentity,
  options: { afterId?: string | null; waitMs?: number; limit?: number } = {},
): Promise<LogRecord[]> {
  const payload = await fetchJson(buildClientLogsUrl(baseUrl, identity, options), logPageSchema, 'logs')
  return payload.records.filter((record) => matchRecordToClient(record, identity))
}
