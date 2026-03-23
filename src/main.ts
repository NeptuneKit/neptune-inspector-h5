import { normalizeBaseUrl } from './api'
import { buildLogsUrl, filterRecords, mergeRecords, pollLogPage } from './logs'
import { buildMetricsUrl, fetchMetrics } from './metrics'
import { buildSourcesUrl, fetchSources, sortSources } from './sources'
import type { InspectorState, LogRecord, MetricsSnapshot, Source } from './types'
import './styles.css'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('app root not found')
}

const state: InspectorState = {
  baseUrl: normalizeBaseUrl(localStorage.getItem('neptune-inspector-base-url') ?? ''),
  filters: {
    platform: '',
    appId: '',
    sessionId: '',
    level: '',
  },
  status: 'idle',
  error: null,
  records: [],
  nextCursor: null,
  isPolling: false,
  sources: [],
  metrics: null,
  lastRefreshedAt: null,
}

let pollTimer: number | null = null

function setStatus(status: string, error: string | null = null): void {
  state.status = status
  state.error = error
  render()
}

function setBaseUrl(value: string): void {
  state.baseUrl = normalizeBaseUrl(value)
  localStorage.setItem('neptune-inspector-base-url', state.baseUrl)
  render()
}

function setFilter(key: keyof InspectorState['filters'], value: string): void {
  state.filters[key] = value
  render()
}

function replaceLogs(records: LogRecord[], nextCursor: string | null): void {
  state.records = mergeRecords(state.records, records)
  state.nextCursor = nextCursor
  state.lastRefreshedAt = new Date().toISOString()
  render()
}

function replaceSources(sources: Source[]): void {
  state.sources = sortSources(sources)
  state.lastRefreshedAt = new Date().toISOString()
  render()
}

function replaceMetrics(snapshot: MetricsSnapshot): void {
  state.metrics = snapshot
  state.lastRefreshedAt = new Date().toISOString()
  render()
}

async function loadLogsOnce(): Promise<void> {
  const page = await pollLogPage(state.baseUrl, state.nextCursor, 0)
  replaceLogs(page.records, page.nextCursor)
}

async function refreshAll(): Promise<void> {
  setStatus('refreshing', null)
  const [logsResult, sourcesResult, metricsResult] = await Promise.allSettled([
    loadLogsOnce(),
    fetchSources(state.baseUrl).then((sources) => {
      replaceSources(sources)
    }),
    fetchMetrics(state.baseUrl).then((snapshot) => {
      replaceMetrics(snapshot)
    }),
  ])

  const errors: string[] = []

  if (logsResult.status === 'rejected') {
    errors.push(formatError('logs', logsResult.reason))
  }
  if (sourcesResult.status === 'rejected') {
    errors.push(formatError('sources', sourcesResult.reason))
  }
  if (metricsResult.status === 'rejected') {
    errors.push(formatError('metrics', metricsResult.reason))
  }

  if (errors.length > 0) {
    setStatus('partial refresh', errors.join(' | '))
    return
  }

  state.lastRefreshedAt = new Date().toISOString()
  setStatus(`loaded ${state.records.length} logs, ${state.sources.length} sources`, null)
}

async function startPolling(): Promise<void> {
  if (state.isPolling) {
    return
  }
  state.isPolling = true
  setStatus('polling logs', null)

  const loop = async (): Promise<void> => {
    if (!state.isPolling) {
      return
    }
    try {
      const page = await pollLogPage(state.baseUrl, state.nextCursor, 1500)
      if (page.records.length > 0) {
        replaceLogs(page.records, page.nextCursor)
      }
      pollTimer = window.setTimeout(loop, 100)
    } catch (error) {
      setStatus('poll error', error instanceof Error ? error.message : String(error))
      pollTimer = window.setTimeout(loop, 1000)
    }
  }

  await loop()
}

function stopPolling(): void {
  state.isPolling = false
  if (pollTimer !== null) {
    window.clearTimeout(pollTimer)
    pollTimer = null
  }
  setStatus('stopped', null)
}

function clearLogs(): void {
  state.records = []
  state.nextCursor = null
  state.lastRefreshedAt = new Date().toISOString()
  render()
}

function render(): void {
  const visible = filterRecords(state.records, state.filters)
  const metrics = state.metrics

  app.innerHTML = `
    <main class="shell">
      <header class="hero">
        <div>
          <p class="eyebrow">NeptuneKit v2</p>
          <h1>H5 Inspector</h1>
          <p class="subtitle">查看 logs、sources、metrics 三类网关快照；logs 保持长轮询增量刷新。</p>
        </div>
        <div class="status ${state.error ? 'status-error' : ''}">
          <span>${escapeHtml(state.status)}</span>
          <span>${escapeHtml(state.error ?? state.baseUrl)}</span>
        </div>
      </header>

      <section class="panel controls">
        <label>
          <span>Gateway BaseURL</span>
          <input id="base-url" value="${escapeHtml(state.baseUrl)}" placeholder="http://127.0.0.1:18765" />
        </label>
        <div class="actions">
          <button id="refresh-button">Refresh All</button>
          <button id="poll-button">Start Logs Poll</button>
          <button id="stop-button">Stop</button>
          <button id="clear-button" class="ghost">Clear Logs</button>
        </div>
      </section>

      <section class="summary-strip">
        <div class="summary-chip"><strong>${state.records.length}</strong><span>Logs</span></div>
        <div class="summary-chip"><strong>${state.sources.length}</strong><span>Sources</span></div>
        <div class="summary-chip"><strong>${metrics ? metrics.totalRecords : '-'}</strong><span>Retained</span></div>
        <div class="summary-chip"><strong>${state.lastRefreshedAt ? escapeHtml(formatTime(state.lastRefreshedAt)) : '-'}</strong><span>Last Sync</span></div>
      </section>

      <section class="dashboard">
        <section class="panel list">
          <div class="list-header">
            <div>
              <h2>Logs</h2>
              <p>当前页面只保留增量合并后的日志记录，并支持 <code>afterId + waitMs</code> 长轮询。</p>
            </div>
            <code>${escapeHtml(buildLogsUrl(state.baseUrl, { afterId: state.nextCursor, waitMs: 1500, limit: 100 }))}</code>
          </div>

          <section class="filters">
            ${renderFilterInput('platform', 'Platform')}
            ${renderFilterInput('appId', 'App ID')}
            ${renderFilterInput('sessionId', 'Session ID')}
            ${renderFilterInput('level', 'Level')}
          </section>

          <div class="summary-grid">
            <div><strong>${state.records.length}</strong><span>Total</span></div>
            <div><strong>${visible.length}</strong><span>Visible</span></div>
            <div><strong>${state.nextCursor ?? '-'}</strong><span>Next Cursor</span></div>
            <div><strong>${state.isPolling ? 'on' : 'off'}</strong><span>Poll</span></div>
          </div>

          <div class="records">
            ${visible.length > 0 ? visible.map(renderLogRecord).join('') : '<div class="empty">No logs yet.</div>'}
          </div>
        </section>

        <section class="panel list">
          <div class="list-header">
            <div>
              <h2>Sources</h2>
              <p>读取 <code>/v2/sources</code> 快照并按最近活跃时间排序。</p>
            </div>
            <code>${escapeHtml(buildSourcesUrl(state.baseUrl))}</code>
          </div>

          <div class="summary-grid compact">
            <div><strong>${state.sources.length}</strong><span>Known</span></div>
            <div><strong>${state.sources.filter((item) => item.status === 'online').length}</strong><span>Online</span></div>
            <div><strong>${state.sources.filter((item) => item.status === 'stale').length}</strong><span>Stale</span></div>
            <div><strong>${state.sources.filter((item) => item.status === 'offline').length}</strong><span>Offline</span></div>
          </div>

          <div class="records sources">
            ${state.sources.length > 0 ? state.sources.map(renderSource).join('') : '<div class="empty">No sources loaded.</div>'}
          </div>
        </section>

        <section class="panel list">
          <div class="list-header">
            <div>
              <h2>Metrics</h2>
              <p>读取 <code>/v2/metrics</code> 的聚合快照。</p>
            </div>
            <code>${escapeHtml(buildMetricsUrl(state.baseUrl))}</code>
          </div>

          <div class="metrics-grid">
            <div class="metric-card">
              <span>Accepted</span>
              <strong>${metrics ? metrics.ingestAcceptedTotal : '-'}</strong>
            </div>
            <div class="metric-card">
              <span>Sources</span>
              <strong>${metrics ? metrics.sourceCount : '-'}</strong>
            </div>
            <div class="metric-card">
              <span>Records</span>
              <strong>${metrics ? metrics.totalRecords : '-'}</strong>
            </div>
            <div class="metric-card">
              <span>Dropped</span>
              <strong>${metrics ? metrics.droppedOverflow : '-'}</strong>
            </div>
          </div>

          <div class="records">
            ${metrics ? renderMetricsSummary(metrics) : '<div class="empty">No metrics loaded.</div>'}
          </div>
        </section>
      </section>
    </main>
  `

  bindEvents()
}

function renderFilterInput(key: keyof InspectorState['filters'], label: string): string {
  return `
    <label>
      <span>${label}</span>
      <input data-filter="${key}" value="${escapeHtml(state.filters[key] ?? '')}" placeholder="${label}" />
    </label>
  `
}

function renderLogRecord(record: LogRecord): string {
  const source = record.source
  const attributes = record.attributes ? Object.entries(record.attributes) : []

  return `
    <article class="record">
      <div class="record-head">
        <strong>#${record.id} ${escapeHtml(record.level)}</strong>
        <span>${escapeHtml(record.timestamp)}</span>
      </div>
      <p>${escapeHtml(record.message)}</p>
      <dl>
        <div><dt>platform</dt><dd>${escapeHtml(record.platform)}</dd></div>
        <div><dt>appId</dt><dd>${escapeHtml(record.appId)}</dd></div>
        <div><dt>sessionId</dt><dd>${escapeHtml(record.sessionId)}</dd></div>
        <div><dt>category</dt><dd>${escapeHtml(record.category)}</dd></div>
      </dl>
      ${
        source
          ? `
        <div class="source-block">
          <strong>Source</strong>
          <span>${escapeHtml([source.sdkName, source.sdkVersion].filter(Boolean).join(' '))}</span>
          <span>${escapeHtml([source.file, source.function].filter(Boolean).join(' · '))}${source.line ? ` · ${source.line}` : ''}</span>
        </div>
      `
          : ''
      }
      ${
        attributes.length > 0
          ? `
        <div class="attributes">
          ${attributes
            .map(([key, value]) => `<span><code>${escapeHtml(key)}</code>${escapeHtml(value)}</span>`)
            .join('')}
        </div>
      `
          : ''
      }
    </article>
  `
}

function renderSource(source: Source): string {
  return `
    <article class="record source-card">
      <div class="record-head">
        <strong>${escapeHtml(source.platform)}</strong>
        <span>${escapeHtml(source.status ?? 'unknown')}</span>
      </div>
      <p>${escapeHtml(source.appId)}</p>
      <dl>
        <div><dt>sessionId</dt><dd>${escapeHtml(source.sessionId)}</dd></div>
        <div><dt>deviceId</dt><dd>${escapeHtml(source.deviceId)}</dd></div>
        <div><dt>lastSeenAt</dt><dd>${escapeHtml(source.lastSeenAt)}</dd></div>
        <div><dt>sdk</dt><dd>${escapeHtml([source.sdkName, source.sdkVersion].filter(Boolean).join(' ') || '-')}</dd></div>
      </dl>
    </article>
  `
}

function renderMetricsSummary(metrics: MetricsSnapshot): string {
  return `
    <article class="record metrics-summary">
      <div class="record-head">
        <strong>Gateway Snapshot</strong>
        <span>${escapeHtml(formatTime(state.lastRefreshedAt ?? new Date().toISOString()))}</span>
      </div>
      <dl>
        <div><dt>ingestAcceptedTotal</dt><dd>${metrics.ingestAcceptedTotal}</dd></div>
        <div><dt>sourceCount</dt><dd>${metrics.sourceCount}</dd></div>
        <div><dt>totalRecords</dt><dd>${metrics.totalRecords}</dd></div>
        <div><dt>droppedOverflow</dt><dd>${metrics.droppedOverflow}</dd></div>
      </dl>
    </article>
  `
}

function bindEvents(): void {
  const baseUrlInput = document.querySelector<HTMLInputElement>('#base-url')
  baseUrlInput?.addEventListener('change', () => {
    if (baseUrlInput.value.trim()) {
      setBaseUrl(baseUrlInput.value)
    }
  })

  document.querySelector('#refresh-button')?.addEventListener('click', () => void refreshAll())
  document.querySelector('#poll-button')?.addEventListener('click', () => void startPolling())
  document.querySelector('#stop-button')?.addEventListener('click', () => stopPolling())
  document.querySelector('#clear-button')?.addEventListener('click', () => clearLogs())

  document.querySelectorAll<HTMLInputElement>('input[data-filter]').forEach((input) => {
    input.addEventListener('input', () => {
      const key = input.dataset.filter as keyof InspectorState['filters']
      setFilter(key, input.value)
    })
  })
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatError(scope: string, reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason)
  return `${scope}: ${message}`
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'medium',
    hour12: false,
  }).format(date)
}

render()
void refreshAll()
