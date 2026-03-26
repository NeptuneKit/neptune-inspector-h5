import { mergeRecords } from './logs'
import type { LogRecord, WsInboxItem } from './types'

export interface InspectorWsTargetInput {
  platforms: string
  appIds: string
  sessionIds: string
  deviceIds: string
}

export interface InspectorWsTarget {
  platforms: string[]
  appIds: string[]
  sessionIds: string[]
  deviceIds: string[]
}

export interface InspectorWsPingMessage {
  type: 'command.send'
  requestId: string
  command: 'ping'
  target: InspectorWsTarget
}

export interface InspectorWsClientCallbacks {
  onConnectionChange?: (snapshot: { connected: boolean; status: string }) => void
  onInboxItem?: (item: WsInboxItem) => void
  onLogRecord?: (record: LogRecord) => void
}

export interface InspectorWsClientOptions extends InspectorWsClientCallbacks {
  baseUrl: string
  webSocketFactory?: (url: string) => InspectorWebSocketLike
  requestIdFactory?: () => string
  heartbeatMs?: number
  reconnectDelaysMs?: number[]
  now?: () => Date
}

export interface InspectorWsSendResult {
  ok: boolean
  error?: string
}

export interface InspectorWebSocketLike {
  readonly readyState: number
  onopen: ((event: unknown) => void) | null
  onclose: ((event: unknown) => void) | null
  onerror: ((event: unknown) => void) | null
  onmessage: ((event: { data: string }) => void) | null
  send(data: string): void
  close(code?: number, reason?: string): void
}

const DEFAULT_HEARTBEAT_MS = 15_000
const DEFAULT_RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000]
const CONNECTING_STATE = 0
const OPEN_STATE = 1

type InspectorWsEnvelope =
  | {
      type: 'ack'
      requestId?: string | null
      accepted?: boolean | null
      delivered?: number | null
      message?: string | null
    }
  | {
      type: 'event'
      topic: string
      requestId?: string | null
      commandId?: string | null
      accepted?: boolean | null
      delivered?: number | null
      acked?: number | null
      timeout?: number | null
      status?: string | null
      command?: string | null
      message?: string | null
      record?: LogRecord | null
      payload?: unknown
    }
  | {
      type: string
      [key: string]: unknown
    }

interface InspectorWsAckEnvelope {
  type: string
  requestId?: string | null
  accepted?: boolean | null
  delivered?: number | null
  message?: string | null
}

interface InspectorWsEventEnvelope {
  type: string
  topic?: string
  requestId?: string | null
  commandId?: string | null
  accepted?: boolean | null
  delivered?: number | null
  acked?: number | null
  timeout?: number | null
  status?: string | null
  command?: string | null
  message?: string | null
  record?: LogRecord | null
  payload?: unknown
}

export function buildInspectorWsUrl(baseUrl: string): string {
  const url = new URL('/v2/ws', normalizeInspectorBaseUrl(baseUrl))
  if (url.protocol === 'http:') {
    url.protocol = 'ws:'
  } else if (url.protocol === 'https:') {
    url.protocol = 'wss:'
  }
  return url.toString()
}

export function normalizeInspectorBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  if (!trimmed) {
    return 'http://127.0.0.1:18765'
  }
  return trimmed.replace(/\/$/, '')
}

export function normalizeInspectorPingTarget(input: InspectorWsTargetInput): InspectorWsTarget {
  return {
    platforms: splitInspectorTargetList(input.platforms),
    appIds: splitInspectorTargetList(input.appIds),
    sessionIds: splitInspectorTargetList(input.sessionIds),
    deviceIds: splitInspectorTargetList(input.deviceIds),
  }
}

export function validateInspectorPingTarget(target: InspectorWsTarget): string | null {
  if (target.platforms.length > 0 || target.appIds.length > 0 || target.sessionIds.length > 0 || target.deviceIds.length > 0) {
    return null
  }

  return 'command.send(ping) 需要至少一个非空 target：platforms | appIds | sessionIds | deviceIds'
}

export function buildInspectorPingMessage(target: InspectorWsTarget, requestId: string): InspectorWsPingMessage {
  return {
    type: 'command.send',
    requestId,
    command: 'ping',
    target,
  }
}

export function nextInspectorReconnectDelayMs(attempt: number): number {
  const delays = DEFAULT_RECONNECT_DELAYS_MS
  return delays[Math.min(Math.max(attempt, 0), delays.length - 1)] ?? delays[delays.length - 1] ?? 8000
}

export function describeInspectorWsEnvelope(raw: string): { item?: WsInboxItem; logRecord?: LogRecord } | null {
  const parsed = parseInspectorWsEnvelope(raw)
  if (!parsed) {
    return null
  }

  if (parsed.type === 'ack' || parsed.type === 'ack.received') {
    return {
      item: {
        timestamp: nowIso(),
        topic: 'ack',
        message: describeAck(parsed as InspectorWsAckEnvelope),
      },
    }
  }

  if (parsed.type === 'event' || parsed.type.startsWith('event.')) {
    const eventEnvelope = parsed as InspectorWsEventEnvelope
    const topicName = eventEnvelope.type === 'event' ? eventEnvelope.topic ?? '' : eventEnvelope.type.slice('event.'.length)
    const topic = topicName.startsWith('event.') ? topicName : `event.${topicName}`
    if (topicName === 'log_record') {
      const record = normalizeLogRecord(eventEnvelope)
      if (!record) {
        return {
          item: {
            timestamp: nowIso(),
            topic,
            message: 'event.log_record malformed payload',
          },
        }
      }

      return {
        item: {
          timestamp: nowIso(),
          topic,
          message: describeLogRecord(record),
        },
        logRecord: record,
      }
    }

    if (topicName === 'command_ack') {
      return {
        item: {
          timestamp: nowIso(),
          topic,
          message: describeCommandAck(eventEnvelope),
        },
      }
    }

    if (topicName === 'command_summary') {
      return {
        item: {
          timestamp: nowIso(),
          topic,
          message: describeCommandSummary(eventEnvelope),
        },
      }
    }

    return {
      item: {
        timestamp: nowIso(),
        topic,
        message: describeUnknownEvent(eventEnvelope),
      },
    }
  }

  return {
    item: {
      timestamp: nowIso(),
      topic: parsed.type,
      message: describeUnknownMessage(parsed),
    },
  }
}

export class InspectorWsClient {
  private socket: InspectorWebSocketLike | null = null
  private reconnectTimer: number | null = null
  private heartbeatTimer: number | null = null
  private stopped = true
  private reconnectAttempt = 0
  private readonly heartbeatMs: number
  private readonly reconnectDelaysMs: number[]

  constructor(private readonly options: InspectorWsClientOptions) {
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS
    this.reconnectDelaysMs = options.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS
  }

  start(): void {
    if (!this.stopped) {
      return
    }

    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    this.clearTimers()
    this.reconnectAttempt = 0

    const socket = this.socket
    this.socket = null
    if (socket?.readyState === CONNECTING_STATE) {
      // Avoid browser console noise when closing a socket before handshake completes.
      socket.onmessage = null
      socket.onerror = null
      socket.onclose = null
      socket.onopen = () => {
        socket.close()
      }
    } else {
      socket?.close()
    }
    this.notifyConnection(false, 'disconnected')
  }

  setBaseUrl(baseUrl: string): void {
    const normalized = normalizeInspectorBaseUrl(baseUrl)
    if (normalized === normalizeInspectorBaseUrl(this.options.baseUrl)) {
      return
    }

    const wasRunning = !this.stopped
    this.stop()
    this.options.baseUrl = normalized

    if (wasRunning) {
      this.start()
    }
  }

  sendPing(input: InspectorWsTargetInput): InspectorWsSendResult {
    const target = normalizeInspectorPingTarget(input)
    const validationError = validateInspectorPingTarget(target)
    if (validationError) {
      this.pushInbox('command.send', validationError)
      this.notifyConnection(this.socket?.readyState === OPEN_STATE, validationError)
      return { ok: false, error: validationError }
    }

    const socket = this.socket
    if (!socket || socket.readyState !== OPEN_STATE) {
      const error = 'websocket 未连接'
      this.pushInbox('command.send', error)
      this.notifyConnection(false, error)
      return { ok: false, error }
    }

    const message = buildInspectorPingMessage(target, this.requestId())
    socket.send(JSON.stringify(message))
    this.pushInbox('command.send', `ping -> ${describeInspectorTarget(target)}`)
    return { ok: true }
  }

  private connect(): void {
    if (this.stopped) {
      return
    }

    this.clearTimers()
    this.notifyConnection(false, `connecting ${buildInspectorWsUrl(this.options.baseUrl)}`)

    const socket = this.createSocket(buildInspectorWsUrl(this.options.baseUrl))
    this.socket = socket

    socket.onopen = () => {
      this.reconnectAttempt = 0
      this.notifyConnection(true, `connected ${buildInspectorWsUrl(this.options.baseUrl)}`)
      socket.send(
        JSON.stringify({
          type: 'hello',
          role: 'inspector',
        }),
      )
      this.startHeartbeat()
    }

    socket.onmessage = (event) => {
      const raw = typeof event.data === 'string' ? event.data : String(event.data)
      const summary = describeInspectorWsEnvelope(raw)
      if (!summary) {
        this.pushInbox('ws.invalid', 'invalid websocket payload')
        return
      }

      if (summary.item) {
        this.pushInbox(summary.item.topic, summary.item.message, summary.item.timestamp)
      }

      if (summary.logRecord) {
        this.options.onLogRecord?.(summary.logRecord)
      }
    }

    socket.onerror = () => {
      this.notifyConnection(false, 'ws error')
    }

    socket.onclose = () => {
      this.stopHeartbeat()
      this.socket = null

      if (this.stopped) {
        return
      }

      const delay = this.nextReconnectDelay()
      this.notifyConnection(false, `reconnecting in ${delay}ms`)
      this.reconnectTimer = globalThis.setTimeout(() => {
        this.reconnectTimer = null
        this.connect()
      }, delay)
    }
  }

  private createSocket(url: string): InspectorWebSocketLike {
    const factory = this.options.webSocketFactory
    if (factory) {
      return factory(url)
    }

    if (typeof WebSocket === 'undefined') {
      throw new Error('WebSocket is not available in this environment')
    }

    return new WebSocket(url) as unknown as InspectorWebSocketLike
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = globalThis.setInterval(() => {
      const socket = this.socket
      if (!socket || socket.readyState !== OPEN_STATE) {
        return
      }

      socket.send(
        JSON.stringify({
          type: 'heartbeat',
          timestamp: this.nowIso(),
        }),
      )
    }, this.heartbeatMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      globalThis.clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private clearTimers(): void {
    this.stopHeartbeat()
    if (this.reconnectTimer !== null) {
      globalThis.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private nextReconnectDelay(): number {
    const delay = this.reconnectDelaysMs[Math.min(this.reconnectAttempt, this.reconnectDelaysMs.length - 1)]
    this.reconnectAttempt += 1
    return delay ?? this.reconnectDelaysMs[this.reconnectDelaysMs.length - 1] ?? 8000
  }

  private pushInbox(topic: string, message: string, timestamp = this.nowIso()): void {
    this.options.onInboxItem?.({
      timestamp,
      topic,
      message,
    })
  }

  private notifyConnection(connected: boolean, status: string): void {
    this.options.onConnectionChange?.({
      connected,
      status,
    })
  }

  private requestId(): string {
    return this.options.requestIdFactory?.() ?? globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }

  private nowIso(): string {
    return this.options.now?.().toISOString() ?? new Date().toISOString()
  }
}

function parseInspectorWsEnvelope(raw: string): InspectorWsEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as InspectorWsEnvelope
    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

function splitInspectorTargetList(value: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const chunk of value.split(/[\n,]/)) {
    const trimmed = chunk.trim()
    if (!trimmed || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    result.push(trimmed)
  }

  return result
}

function describeInspectorTarget(target: InspectorWsTarget): string {
  return [
    target.platforms.length > 0 ? `platforms=${target.platforms.join(',')}` : null,
    target.appIds.length > 0 ? `appIds=${target.appIds.join(',')}` : null,
    target.sessionIds.length > 0 ? `sessionIds=${target.sessionIds.join(',')}` : null,
    target.deviceIds.length > 0 ? `deviceIds=${target.deviceIds.join(',')}` : null,
  ]
    .filter((item): item is string => item !== null)
    .join(' | ')
}

function describeAck(envelope: InspectorWsAckEnvelope): string {
  const parts = [`accepted=${String(Boolean(envelope.accepted))}`]
  if (typeof envelope.delivered === 'number') {
    parts.push(`delivered=${envelope.delivered}`)
  }
  if (envelope.requestId) {
    parts.push(`requestId=${envelope.requestId}`)
  }
  return parts.join(' ')
}

function describeCommandAck(envelope: InspectorWsEventEnvelope): string {
  const parts = ['command_ack']
  if (envelope.command) {
    parts.push(`command=${envelope.command}`)
  }
  if (envelope.commandId) {
    parts.push(`commandId=${envelope.commandId}`)
  }
  if (envelope.status) {
    parts.push(`status=${envelope.status}`)
  }
  if (typeof envelope.accepted === 'boolean') {
    parts.push(`accepted=${String(envelope.accepted)}`)
  }
  if (typeof envelope.delivered === 'number') {
    parts.push(`delivered=${envelope.delivered}`)
  }
  if (envelope.requestId) {
    parts.push(`requestId=${envelope.requestId}`)
  }
  return parts.join(' ')
}

function describeCommandSummary(envelope: InspectorWsEventEnvelope): string {
  const parts = ['command_summary']
  if (envelope.command) {
    parts.push(`command=${envelope.command}`)
  }
  if (envelope.commandId) {
    parts.push(`commandId=${envelope.commandId}`)
  }
  if (typeof envelope.delivered === 'number') {
    parts.push(`delivered=${envelope.delivered}`)
  }
  if (typeof envelope.acked === 'number') {
    parts.push(`acked=${envelope.acked}`)
  }
  if (typeof envelope.timeout === 'number') {
    parts.push(`timeout=${envelope.timeout}`)
  }
  if (envelope.requestId) {
    parts.push(`requestId=${envelope.requestId}`)
  }
  return parts.join(' ')
}

function describeLogRecord(record: LogRecord): string {
  return `#${record.id} ${record.level} ${record.platform} ${record.message}`
}

function describeUnknownEvent(envelope: InspectorWsEventEnvelope): string {
  return `${envelope.topic ?? envelope.type}${envelope.requestId ? ` requestId=${envelope.requestId}` : ''}`
}

function describeUnknownMessage(envelope: InspectorWsEnvelope): string {
  return envelope.type
}

function normalizeLogRecord(envelope: InspectorWsEventEnvelope): LogRecord | null {
  if (envelope.record && typeof envelope.record === 'object') {
    return envelope.record
  }

  const payload = envelope.payload
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const record = payload as LogRecord
  if (
    typeof record.id === 'number' &&
    typeof record.timestamp === 'string' &&
    typeof record.level === 'string' &&
    typeof record.message === 'string' &&
    typeof record.platform === 'string' &&
    typeof record.appId === 'string' &&
    typeof record.sessionId === 'string' &&
    typeof record.deviceId === 'string' &&
    typeof record.category === 'string'
  ) {
    return record
  }

  return null
}

function nowIso(): string {
  return new Date().toISOString()
}

export function mergeWsLogRecords(existing: LogRecord[], incoming: LogRecord[]): LogRecord[] {
  return mergeRecords(existing, incoming)
}

export function createInspectorWsClient(options: InspectorWsClientOptions): InspectorWsClient {
  return new InspectorWsClient(options)
}
