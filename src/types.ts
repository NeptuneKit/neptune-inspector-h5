export type Platform = 'ios' | 'android' | 'harmony' | 'web'
export type LogLevel = 'trace' | 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical'
export type SourceStatus = 'online' | 'offline' | 'stale'

export interface LogSource {
  sdkName?: string
  sdkVersion?: string
  file?: string
  function?: string
  line?: number
}

export interface LogRecord {
  id: number
  timestamp: string
  level: LogLevel
  message: string
  platform: Platform
  appId: string
  sessionId: string
  deviceId: string
  category: string
  attributes?: Record<string, string>
  source?: LogSource
}

export interface LogPage {
  records: LogRecord[]
  nextCursor: string | null
  hasMore: boolean
}

export interface Source {
  platform: Platform
  appId: string
  sessionId: string
  deviceId: string
  lastSeenAt: string
  sdkName?: string | null
  sdkVersion?: string | null
  status?: SourceStatus | null
}

export interface Client {
  platform: Platform
  appId: string
  deviceId: string
  sessionId: string
  callbackEndpoint: string
  lastSeenAt: string
  ttlSeconds: number
  sdkName?: string | null
  sdkVersion?: string | null
}

export interface SelectedClientIdentity {
  platform: Platform
  appId: string
  deviceId: string
  sessionId: string
}

export interface SelectedClientsPayload {
  selected: SelectedClientIdentity[]
}

export interface MetricsSnapshot {
  ingestAcceptedTotal: number
  sourceCount: number
  totalRecords: number
  droppedOverflow: number
}

export interface LogQueryFilters {
  platform?: string
  appId?: string
  sessionId?: string
  level?: string
}

export interface InspectorState {
  baseUrl: string
  filters: LogQueryFilters
  status: string
  error: string | null
  records: LogRecord[]
  nextCursor: string | null
  isPolling: boolean
  clients: Client[]
  selectedClientKeys: string[]
  clientsSyncMessage: string
  metrics: MetricsSnapshot | null
  lastRefreshedAt: string | null
  wsConnected: boolean
  wsStatus: string
  wsTargetPlatforms: string
  wsTargetAppIds: string
  wsTargetSessionIds: string
  wsTargetDeviceIds: string
  wsOutboundMessage: string
  wsInbox: WsInboxItem[]
}

export interface WsInboxItem {
  timestamp: string
  topic: string
  message: string
}
