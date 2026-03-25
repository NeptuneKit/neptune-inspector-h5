import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LogRecord } from '../src/types'
import {
  buildInspectorPingMessage,
  buildInspectorWsUrl,
  createInspectorWsClient,
  nextInspectorReconnectDelayMs,
  normalizeInspectorPingTarget,
  validateInspectorPingTarget,
} from '../src/ws'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  FakeSocket.instances = []
})

describe('inspector ws helpers', () => {
  it('builds ws urls from http and https gateways', () => {
    expect(buildInspectorWsUrl('http://127.0.0.1:18765/')).toBe('ws://127.0.0.1:18765/v2/ws')
    expect(buildInspectorWsUrl('https://example.com/base/')).toBe('wss://example.com/v2/ws')
  })

  it('normalizes ping targets and rejects empty targets', () => {
    const target = normalizeInspectorPingTarget({
      platforms: ' ios, android ',
      appIds: '',
      sessionIds: 'session-a\nsession-b',
      deviceIds: '  ',
    })

    expect(target.platforms).toEqual(['ios', 'android'])
    expect(target.sessionIds).toEqual(['session-a', 'session-b'])
    expect(validateInspectorPingTarget(target)).toBeNull()
    expect(validateInspectorPingTarget(normalizeInspectorPingTarget({ platforms: '', appIds: '', sessionIds: '', deviceIds: '' }))).toMatch(
      /至少一个/,
    )
  })

  it('builds command.send payloads for ping', () => {
    const message = buildInspectorPingMessage(
      normalizeInspectorPingTarget({
        platforms: 'ios',
        appIds: 'demo.app',
        sessionIds: '',
        deviceIds: '',
      }),
      'req-1',
    )

    expect(message).toEqual({
      type: 'command.send',
      requestId: 'req-1',
      command: 'ping',
      target: {
        platforms: ['ios'],
        appIds: ['demo.app'],
        sessionIds: [],
        deviceIds: [],
      },
    })
  })

  it('exposes the reconnect backoff cycle', () => {
    expect(nextInspectorReconnectDelayMs(0)).toBe(500)
    expect(nextInspectorReconnectDelayMs(1)).toBe(1000)
    expect(nextInspectorReconnectDelayMs(2)).toBe(2000)
    expect(nextInspectorReconnectDelayMs(3)).toBe(4000)
    expect(nextInspectorReconnectDelayMs(4)).toBe(8000)
    expect(nextInspectorReconnectDelayMs(7)).toBe(8000)
  })
})

describe('inspector ws client', () => {
  it('sends hello, heartbeats, and reconnects on close', async () => {
    vi.useFakeTimers()

    const client = createInspectorWsClient({
      baseUrl: 'http://127.0.0.1:18765',
      webSocketFactory: (url) => new FakeSocket(url),
      requestIdFactory: () => 'request-1',
      now: () => new Date('2026-03-24T00:00:00.000Z'),
    })

    client.start()

    const first = FakeSocket.instances[0]
    expect(first?.url).toBe('ws://127.0.0.1:18765/v2/ws')

    first?.open()
    expect(first?.sent.map(parseJson)).toContainEqual({
      type: 'hello',
      role: 'inspector',
    })

    await vi.advanceTimersByTimeAsync(15_000)
    expect(first?.sent.map(parseJson)).toContainEqual(expect.objectContaining({
      type: 'heartbeat',
    }))

    first?.close()
    await vi.advanceTimersByTimeAsync(499)
    expect(FakeSocket.instances).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(FakeSocket.instances).toHaveLength(2)
    expect(FakeSocket.instances[1]?.url).toBe('ws://127.0.0.1:18765/v2/ws')
  })

  it('records ack topics and log records from inbound messages', () => {
    const inbox: Array<{ topic: string; message: string }> = []
    const records: LogRecord[] = []

    const client = createInspectorWsClient({
      baseUrl: 'http://127.0.0.1:18765',
      webSocketFactory: (url) => new FakeSocket(url),
      requestIdFactory: () => 'request-1',
      onInboxItem: (item) => inbox.push(item),
      onLogRecord: (record) => records.push(record),
    })

    client.start()
    const socket = FakeSocket.instances[0]
    socket?.open()
    socket?.receive(JSON.stringify({ type: 'ack', requestId: 'request-1', accepted: true, delivered: 0 }))
    socket?.receive(
      JSON.stringify({
        type: 'event.command_ack',
        requestId: 'request-1',
        commandId: 'request-1',
        command: 'ping',
        status: 'ok',
      }),
    )
    socket?.receive(
      JSON.stringify({
        type: 'event.command_summary',
        requestId: 'request-1',
        commandId: 'request-1',
        command: 'ping',
        delivered: 3,
        acked: 2,
        timeout: 1,
      }),
    )
    socket?.receive(
      JSON.stringify({
        type: 'event.log_record',
        record: sampleRecord(),
      }),
    )

    expect(inbox.map((item) => item.topic)).toEqual([
      'ack',
      'event.command_ack',
      'event.command_summary',
      'event.log_record',
    ])
    expect(records).toHaveLength(1)
    expect(records[0]?.message).toBe('ws log')
  })

  it('sends ping commands only when at least one target is selected', () => {
    const socket = new FakeSocket('ws://127.0.0.1:18765/v2/ws')
    const client = createInspectorWsClient({
      baseUrl: 'http://127.0.0.1:18765',
      webSocketFactory: () => socket,
      requestIdFactory: () => 'request-1',
    })

    client.start()
    socket.open()

    const failed = client.sendPing({
      platforms: '',
      appIds: '',
      sessionIds: '',
      deviceIds: '',
    })
    expect(failed.ok).toBe(false)

    const sent = client.sendPing({
      platforms: 'ios',
      appIds: 'demo.app',
      sessionIds: '',
      deviceIds: '',
    })
    expect(sent.ok).toBe(true)
    expect(socket.sent.map(parseJson)).toContainEqual({
      type: 'command.send',
      requestId: 'request-1',
      command: 'ping',
      target: {
        platforms: ['ios'],
        appIds: ['demo.app'],
        sessionIds: [],
        deviceIds: [],
      },
    })
  })
})

class FakeSocket {
  static instances: FakeSocket[] = []

  readonly sent: string[] = []
  readyState = 0
  onopen: ((event: unknown) => void) | null = null
  onclose: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null

  constructor(readonly url: string) {
    FakeSocket.instances.push(this)
  }

  open(): void {
    this.readyState = 1
    this.onopen?.({})
  }

  receive(data: string): void {
    this.onmessage?.({ data })
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = 3
    this.onclose?.({ code: 1000, reason: 'closed', wasClean: true })
  }
}

function parseJson(value: string): unknown {
  return JSON.parse(value)
}

function sampleRecord(): LogRecord {
  return {
    id: 42,
    timestamp: '2026-03-24T00:00:00.000Z',
    level: 'info',
    message: 'ws log',
    platform: 'ios',
    appId: 'demo.app',
    sessionId: 'session-1',
    deviceId: 'device-1',
    category: 'transport',
  }
}
