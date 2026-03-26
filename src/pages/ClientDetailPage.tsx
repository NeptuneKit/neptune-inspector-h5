import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { normalizeBaseUrl } from '../api'
import { safeStorageGet } from '../storage'
import type { LogRecord } from '../types'
import { decodeClientKey } from '../features/clients/clientKey'
import { fetchClientLogs, mergeLogRecords } from '../features/logs/logService'
import { useInspectorLogStream } from '../features/ws/useInspectorLogStream'
import { BASE_URL_STORAGE_KEY, DEFAULT_BASE_URL } from '../shared/constants'

function formatLogTimestamp(input: string): string {
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) {
    return input
  }
  return date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function ClientDetailPage() {
  const { clientKey = '' } = useParams()
  const identity = useMemo(() => decodeClientKey(clientKey), [clientKey])
  const [baseUrl] = useState(() => normalizeBaseUrl(safeStorageGet(BASE_URL_STORAGE_KEY) ?? DEFAULT_BASE_URL))
  const [records, setRecords] = useState<LogRecord[]>([])
  const [logsLoading, setLogsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [wsStatus, setWsStatus] = useState('ws connecting')
  const [wsConnected, setWsConnected] = useState(false)
  const recordsContainerRef = useRef<HTMLDivElement | null>(null)
  const lastRecordIdRef = useRef<string | null>(null)
  const pullInFlightRef = useRef(false)
  const pullQueuedRef = useRef(false)

  const appendRecords = useCallback((incoming: LogRecord[]) => {
    if (incoming.length === 0) {
      return
    }
    setRecords((previous) => {
      const merged = mergeLogRecords(previous, incoming)
      const newest = merged[merged.length - 1]
      const nextRecordId = newest ? String(newest.id) : null
      lastRecordIdRef.current = nextRecordId
      return merged
    })
  }, [])

  const loadHistory = useCallback(async () => {
    if (!identity) {
      return
    }
    setLogsLoading(true)
    setError(null)
    try {
      const result = await fetchClientLogs(baseUrl, identity, { waitMs: 0, limit: 200 })
      setRecords(result)
      const newest = result[result.length - 1]
      const nextRecordId = newest ? String(newest.id) : null
      lastRecordIdRef.current = nextRecordId
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setRecords([])
      lastRecordIdRef.current = null
    } finally {
      setLogsLoading(false)
    }
  }, [baseUrl, identity])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  const pullIncremental = useCallback(async () => {
    if (!identity) {
      return
    }
    if (pullInFlightRef.current) {
      pullQueuedRef.current = true
      return
    }

    pullInFlightRef.current = true
    try {
      while (true) {
        pullQueuedRef.current = false
        const incoming = await fetchClientLogs(baseUrl, identity, {
          afterId: lastRecordIdRef.current,
          waitMs: 0,
          limit: 200,
        })
        if (incoming.length > 0) {
          appendRecords(incoming)
        }
        if (!pullQueuedRef.current) {
          break
        }
      }
    } catch {
      // websocket-triggered pull is best-effort
    } finally {
      pullInFlightRef.current = false
    }
  }, [appendRecords, baseUrl, identity])

  useInspectorLogStream({
    baseUrl,
    identity,
    onRecord: () => {
      void pullIncremental()
    },
    onStatusChange: ({ connected, status }) => {
      setWsConnected(connected)
      setWsStatus(status)
    },
  })

  useEffect(() => {
    if (!autoScroll) {
      return
    }

    const container = recordsContainerRef.current
    if (!container) {
      return
    }

    container.scrollTop = container.scrollHeight
  }, [autoScroll, records])

  if (!identity) {
    return (
      <main className="page detail-page">
        <div className="error-box">无效客户端标识，无法进入详情。</div>
        <Link className="link-btn" to="/">
          返回首页
        </Link>
      </main>
    )
  }

  return (
    <main className="page detail-page">
      <header className="page-header">
        <div className="header-content">
          <nav className="breadcrumb">
            <Link className="breadcrumb-link" to="/">Neptune</Link>
            <span className="breadcrumb-separator">/</span>
            <span className="breadcrumb-current">Client Detail</span>
          </nav>
          <h1>{identity.platform} · {identity.appId}</h1>
          <div className="header-meta">
            <span className={`status-pill status-indicator ${wsConnected ? 'status-ok' : 'status-warn'}`}>
              {wsConnected ? 'ONLINE' : 'OFFLINE'} · {wsStatus}
            </span>
            <span className="meta-chip"><span className="meta-key">platform</span><span className="meta-val">{identity.platform}</span></span>
            <span className="meta-chip"><span className="meta-key">app</span><span className="meta-val">{identity.appId}</span></span>
            <span className="meta-chip"><span className="meta-key">session</span><span className="meta-val">{identity.sessionId}</span></span>
            <span className="meta-chip"><span className="meta-key">device</span><span className="meta-val">{identity.deviceId}</span></span>
          </div>
        </div>
      </header>

      <section className="panel">
        <div className="panel-title-row">
          <h2>日志</h2>
          <div className="toolbar" style={{ gap: '0.75rem' }}>
            <div className="button-group" style={{ height: '32px', padding: '3px' }}>
              <button style={{ height: '24px' }} onClick={loadHistory}>刷新历史</button>
              <div className="divider" />
              <button style={{ height: '24px' }} onClick={() => setRecords([])}>清空日志</button>
            </div>
            <label className="checkbox-group">
              <input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} />
              <span>自动滚动</span>
            </label>
          </div>
        </div>

        {logsLoading ? <div className="empty">加载中...</div> : null}
        {error ? <div className="error-box">{error}</div> : null}

        {!logsLoading && !error && records.length === 0 ? <div className="empty">暂无日志。</div> : null}

        <div className="records" ref={recordsContainerRef}>
          {records.map((record) => (
            <article key={record.id} className="record">
              <div className="record-head">
                <time dateTime={record.timestamp}>{formatLogTimestamp(record.timestamp)}</time>
                <div className="record-head-left">
                  <strong className={`level-badge level-${record.level.toLowerCase()}`}>{record.level.toUpperCase()}</strong>
                  <span className="record-id">#{record.id}</span>
                </div>
              </div>
              <p className="record-message">{record.message}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
