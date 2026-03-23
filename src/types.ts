export type Platform = 'ios' | 'android' | 'harmony' | 'web'
export type LogLevel = 'trace' | 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical'

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
}
