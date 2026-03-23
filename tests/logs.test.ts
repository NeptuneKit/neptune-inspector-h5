import { describe, expect, it } from 'vitest'
import { buildLogsUrl, filterRecords, mergeRecords, normalizeBaseUrl } from '../src/logs'
import type { LogRecord } from '../src/types'

describe('logs helpers', () => {
  it('normalizes base URLs', () => {
    expect(normalizeBaseUrl(' http://127.0.0.1:18765/ ')).toBe('http://127.0.0.1:18765')
  })

  it('merges and sorts records by id', () => {
    const merged = mergeRecords([
      sampleRecord(2),
      sampleRecord(4),
    ], [
      sampleRecord(3),
      sampleRecord(4, 'info', 'ios', 'updated'),
    ])

    expect(merged.map((item) => item.id)).toEqual([2, 3, 4])
    expect(merged.at(-1)?.message).toBe('updated')
  })

  it('filters records by platform and level text', () => {
    const records = [sampleRecord(1, 'info', 'ios'), sampleRecord(2, 'error', 'android')]
    const visible = filterRecords(records, { platform: 'ios', level: 'info' })
    expect(visible).toHaveLength(1)
    expect(visible[0]?.id).toBe(1)
  })

  it('builds polling URLs with wait and cursor', () => {
    const url = buildLogsUrl('http://127.0.0.1:18765/', { afterId: '42', waitMs: 1500, limit: 25 })
    expect(url).toContain('/v2/logs')
    expect(url).toContain('afterId=42')
    expect(url).toContain('waitMs=1500')
    expect(url).toContain('limit=25')
  })
})

function sampleRecord(
  id: number,
  level: LogRecord['level'] = 'info',
  platform: LogRecord['platform'] = 'ios',
  message = `message-${id}`,
): LogRecord {
  return {
    id,
    timestamp: '2026-03-23T23:00:00.000Z',
    level,
    message,
    platform,
    appId: 'app',
    sessionId: 'session',
    deviceId: 'device',
    category: 'default',
  }
}
