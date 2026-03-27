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
  retainedRecordCount: number
  retentionMaxRecordCount: number
  retentionMaxAgeSeconds: number
  retentionDroppedTotal: number
}

export interface LogQueryFilters {
  platform?: string
  appId?: string
  sessionId?: string
  level?: string
}

export interface ViewTreeNode {
  id: string
  parentId: string | null
  name: string
  frame?: ViewTreeFrame
  style?: ViewTreeStyle
  text?: string | null
  visible?: boolean
  children: ViewTreeNode[]
}

export interface ViewTreeFrame {
  x: number
  y: number
  width: number
  height: number
}

export interface ViewTreeStyle {
  opacity?: number
  backgroundColor?: string
  textColor?: string
  typographyUnit?: 'dp'
  sourceTypographyUnit?: 'pt' | 'sp' | 'fp' | 'vp' | 'px' | 'dp'
  platformFontScale?: number
  fontSize?: number
  lineHeight?: number
  letterSpacing?: number
  fontWeight?: string
  fontWeightRaw?: string
  fontFamily?: string
  borderRadius?: number
  borderWidth?: number
  borderColor?: string
  zIndex?: number
  textAlign?: string
  textContentAlign?: string
  textOverflow?: string
  wordBreak?: string
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number
}

export interface ViewTreeSnapshot {
  snapshotId: string
  capturedAt: string
  platform: Platform
  roots: ViewTreeNode[]
}

export interface InspectorSnapshot {
  snapshotId: string
  capturedAt: string
  platform: Platform
  available: boolean
  payload: unknown | null
  reason?: string | null
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
