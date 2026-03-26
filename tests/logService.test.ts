import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LogRecord } from '../src/types'
import { matchRecordToClient } from '../src/features/logs/logMatch'
import { fetchClientLogs, mergeLogRecords } from '../src/features/logs/logService'

const identity = {
  platform: 'ios',
  appId: 'com.demo.app',
  sessionId: 'session-1',
  deviceId: 'device-1',
} as const

describe('log matching', () => {
  it('matches when identity fields are exactly equal', () => {
    expect(matchRecordToClient(sampleRecord(1), identity)).toBe(true)
  })

  it('rejects records from other clients', () => {
    expect(matchRecordToClient(sampleRecord(2, { deviceId: 'device-2' }), identity)).toBe(false)
    expect(matchRecordToClient(sampleRecord(2, { sessionId: 'session-2' }), identity)).toBe(false)
  })
})

describe('log merge', () => {
  it('deduplicates by id and keeps ascending order', () => {
    const merged = mergeLogRecords(
      [sampleRecord(2, { message: 'old' }), sampleRecord(1)],
      [sampleRecord(2, { message: 'new' }), sampleRecord(3)],
    )

    expect(merged.map((record) => record.id)).toEqual([1, 2, 3])
    expect(merged.find((record) => record.id === 2)?.message).toBe('new')
  })
})

describe('fetch client logs', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('filters out records that do not match device id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          records: [sampleRecord(1), sampleRecord(2, { deviceId: 'device-2' })],
          nextCursor: null,
          hasMore: false,
        }),
      })),
    )

    const records = await fetchClientLogs('http://127.0.0.1:18765', identity)
    expect(records).toHaveLength(1)
    expect(records[0]?.deviceId).toBe('device-1')
  })
})

function sampleRecord(id: number, overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    id,
    timestamp: '2026-03-25T00:00:00.000Z',
    level: 'info',
    message: `log-${id}`,
    platform: 'ios',
    appId: 'com.demo.app',
    sessionId: 'session-1',
    deviceId: 'device-1',
    category: 'runtime',
    ...overrides,
  }
}
