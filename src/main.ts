import { normalizeBaseUrl } from './api'
import { buildLogsUrl, filterRecords, mergeRecords, pollLogPage } from './logs'
import { buildMetricsUrl, fetchMetrics } from './metrics'
import { buildClientsUrl, clientSelectionKey, fetchClients, saveSelectedClients, sortClients } from './clients'
import { safeStorageGet, safeStorageSet } from './storage'
import { createInspectorWsClient, mergeWsLogRecords } from './ws'
import type { Client, InspectorState, LogRecord, MetricsSnapshot } from './types'
import './styles.css'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('app root not found')
}

const state: InspectorState = {
  baseUrl: normalizeBaseUrl(safeStorageGet('neptune-inspector-base-url') ?? ''),
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
  clients: [],
  selectedClientKeys: [],
  clientsSyncMessage: '',
  metrics: null,
  lastRefreshedAt: null,
  wsConnected: false,
  wsStatus: 'connecting...',
  wsTargetPlatforms: '',
  wsTargetAppIds: '',
  wsTargetSessionIds: '',
  wsTargetDeviceIds: '',
  wsOutboundMessage: '',
  wsInbox: [],
}

let pollTimer: number | null = null
let wsClient = createInspectorWsClient({
  baseUrl: state.baseUrl,
  onConnectionChange: ({ connected, status }) => {
    state.wsConnected = connected
    state.wsStatus = status
    render()
  },
  onInboxItem: (item) => {
    state.wsInbox = [item, ...state.wsInbox].slice(0, 20)
    render()
  },
  onLogRecord: (record) => {
    state.records = mergeWsLogRecords(state.records, [record])
    state.lastRefreshedAt = new Date().toISOString()
    render()
  },
})

function setStatus(status: string, error: string | null = null): void {
  state.status = status
  state.error = error
  render()
}

function setBaseUrl(value: string): void {
  state.baseUrl = normalizeBaseUrl(value)
  safeStorageSet('neptune-inspector-base-url', state.baseUrl)
  state.selectedClientKeys = []
  state.clientsSyncMessage = ''
  wsClient.setBaseUrl(state.baseUrl)
  render()
}

function setFilter(key: keyof InspectorState['filters'], value: string): void {
  state.filters[key] = value
  render()
}

function setWsTargetField(key: 'wsTargetPlatforms' | 'wsTargetAppIds' | 'wsTargetSessionIds' | 'wsTargetDeviceIds', value: string): void {
  state[key] = value
  render()
}

function replaceLogs(records: LogRecord[], nextCursor: string | null): void {
  state.records = mergeRecords(state.records, records)
  state.nextCursor = nextCursor
  state.lastRefreshedAt = new Date().toISOString()
  render()
}

function replaceClients(clients: Client[]): void {
  state.clients = sortClients(clients)
  pruneSelectedClientKeys()
  state.clientsSyncMessage = ''
  state.lastRefreshedAt = new Date().toISOString()
  render()
}

function replaceMetrics(snapshot: MetricsSnapshot): void {
  state.metrics = snapshot
  state.lastRefreshedAt = new Date().toISOString()
  render()
}

function pruneSelectedClientKeys(): void {
  const availableKeys = new Set(state.clients.map((client) => clientSelectionKey(client)))
  state.selectedClientKeys = state.selectedClientKeys.filter((key) => availableKeys.has(key))
}

function getSelectedClients(): Client[] {
  const selectedKeys = new Set(state.selectedClientKeys)
  return state.clients.filter((client) => selectedKeys.has(clientSelectionKey(client)))
}

function setClientSelected(key: string, selected: boolean): void {
  const next = new Set(state.selectedClientKeys)
  if (selected) {
    next.add(key)
  } else {
    next.delete(key)
  }
  state.selectedClientKeys = Array.from(next)
  state.clientsSyncMessage = ''
  render()
}

async function loadLogsOnce(): Promise<void> {
  const page = await pollLogPage(state.baseUrl, state.nextCursor, 0)
  replaceLogs(page.records, page.nextCursor)
}

async function refreshAll(): Promise<void> {
  setStatus('refreshing', null)
  const [logsResult, clientsResult, metricsResult] = await Promise.allSettled([
    loadLogsOnce(),
    fetchClients(state.baseUrl).then((clients) => {
      replaceClients(clients)
    }),
    fetchMetrics(state.baseUrl).then((snapshot) => {
      replaceMetrics(snapshot)
    }),
  ])

  const errors: string[] = []

  if (logsResult.status === 'rejected') {
    errors.push(formatError('logs', logsResult.reason))
  }
  if (clientsResult.status === 'rejected') {
    errors.push(formatError('clients', clientsResult.reason))
  }
  if (metricsResult.status === 'rejected') {
    errors.push(formatError('metrics', metricsResult.reason))
  }

  if (errors.length > 0) {
    setStatus('partial refresh', errors.join(' | '))
    return
  }

  state.lastRefreshedAt = new Date().toISOString()
  setStatus(`loaded ${state.records.length} logs, ${state.clients.length} clients`, null)
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

async function submitSelectedClients(): Promise<void> {
  const selectedClients = getSelectedClients()

  try {
    await saveSelectedClients(state.baseUrl, selectedClients)
    state.clientsSyncMessage = `PUT /v2/clients:selected 已提交 ${selectedClients.length} 个客户端`
  } catch (error) {
    state.clientsSyncMessage = `PUT /v2/clients:selected 失败：${error instanceof Error ? error.message : String(error)}`
  }

  render()
}

function sendPingCommand(): void {
  const result = wsClient.sendPing(
    {
      platforms: state.wsTargetPlatforms,
      appIds: state.wsTargetAppIds,
      sessionIds: state.wsTargetSessionIds,
      deviceIds: state.wsTargetDeviceIds,
    },
  )

  state.wsOutboundMessage = result.ok ? 'command.send(ping) 已下发' : result.error ?? 'command.send(ping) 失败'
  render()
}

function render(): void {
  const visible = filterRecords(state.records, state.filters)
  const metrics = state.metrics
  const selectedClients = getSelectedClients()
  const selectedClientKeys = new Set(state.selectedClientKeys)

  app.innerHTML = `
    <main class="shell">
      <header class="hero">
        <div>
          <p class="eyebrow">NeptuneKit v2</p>
          <h1>H5 Inspector</h1>
          <p class="subtitle">查看 logs、clients、metrics 快照；同时自动连接 Inspector WS，保留 Refresh All、clients:selected 提交和 logs 长轮询路径。</p>
        </div>
        <div class="status ${state.error ? 'status-error' : ''}">
          <span>${escapeHtml(state.status)}</span>
          <span>${escapeHtml(state.error ?? state.baseUrl)}</span>
          <span>${escapeHtml(`${state.wsConnected ? 'ws connected' : 'ws offline'} · ${state.wsStatus}`)}</span>
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

      <section class="panel ws-panel">
        <div class="list-header">
          <div>
            <h2>Inspector WS</h2>
            <p>自动连接 <code>${escapeHtml(buildInspectorWsUrl(state.baseUrl))}</code>，发送 <code>hello(role=inspector)</code> 并保持 15s heartbeat。</p>
          </div>
          <code>${escapeHtml(state.wsStatus)}</code>
        </div>

        <div class="ws-layout">
          <section class="ws-form">
            <div class="ws-grid">
              ${renderWsTargetInput('wsTargetPlatforms', 'Platforms', 'ios, android')}
              ${renderWsTargetInput('wsTargetAppIds', 'App IDs', 'demo.app')}
              ${renderWsTargetInput('wsTargetSessionIds', 'Session IDs', 'session-1')}
              ${renderWsTargetInput('wsTargetDeviceIds', 'Device IDs', 'device-1')}
            </div>
            <div class="actions">
              <button id="ws-send-ping-button">Send Ping</button>
            </div>
            <div class="ws-outbound">${escapeHtml(state.wsOutboundMessage || 'command.send(ping) 等待下发')}</div>
          </section>

          <section class="ws-inbox">
            <div class="summary-grid compact">
              <div><strong>${state.wsInbox.length}</strong><span>Inbox</span></div>
              <div><strong>${state.wsConnected ? 'yes' : 'no'}</strong><span>Connected</span></div>
              <div><strong>${state.wsTargetPlatforms || state.wsTargetAppIds || state.wsTargetSessionIds || state.wsTargetDeviceIds ? 'set' : '-'}</strong><span>Target</span></div>
              <div><strong>${state.wsOutboundMessage ? 'ready' : '-'}</strong><span>Outbound</span></div>
            </div>
            <div class="records ws-records">
              ${
                state.wsInbox.length > 0
                  ? state.wsInbox.map(renderWsInboxItem).join('')
                  : '<div class="empty">No WS events yet.</div>'
              }
            </div>
          </section>
        </div>
      </section>

      <section class="summary-strip">
        <div class="summary-chip"><strong>${state.records.length}</strong><span>Logs</span></div>
        <div class="summary-chip"><strong>${state.clients.length}</strong><span>Clients</span></div>
        <div class="summary-chip"><strong>${metrics ? metrics.totalRecords : '-'}</strong><span>Retained</span></div>
        <div class="summary-chip"><strong>${state.lastRefreshedAt ? escapeHtml(formatTime(state.lastRefreshedAt)) : '-'}</strong><span>Last Sync</span></div>
      </section>

      <section class="dashboard">
        <section class="panel list">
          <div class="list-header">
            <div>
              <h2>Logs</h2>
              <p>当前页面保留增量合并后的日志记录，并支持 <code>afterId + waitMs</code> 长轮询。</p>
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
              <h2>Clients</h2>
              <p>读取 <code>/v2/clients</code> 快照并按最近活跃时间排序，勾选后通过 <code>PUT /v2/clients:selected</code> 全量提交。</p>
            </div>
            <code>${escapeHtml(buildClientsUrl(state.baseUrl))}</code>
          </div>

          <div class="summary-grid compact clients-summary">
            <div><strong>${state.clients.length}</strong><span>Total</span></div>
            <div><strong>${selectedClients.length}</strong><span>Selected</span></div>
            <div><strong>${state.clients.filter((item) => item.ttlSeconds > 0).length}</strong><span>TTL Set</span></div>
            <div><strong>${state.clientsSyncMessage ? 'saved' : '-'}</strong><span>Submit</span></div>
          </div>

          <div class="actions client-actions">
            <button id="clients-save-button">Save Selected</button>
          </div>
          <div class="client-outbound">${escapeHtml(state.clientsSyncMessage || 'PUT /v2/clients:selected 等待提交')}</div>

          <div class="records clients">
            ${state.clients.length > 0 ? state.clients.map((client) => renderClient(client, selectedClientKeys.has(clientSelectionKey(client)))).join('') : '<div class="empty">No clients loaded.</div>'}
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

function renderWsTargetInput(key: keyof Pick<InspectorState, 'wsTargetPlatforms' | 'wsTargetAppIds' | 'wsTargetSessionIds' | 'wsTargetDeviceIds'>, label: string, placeholder: string): string {
  return `
    <label>
      <span>${label}</span>
      <input data-ws-target="${key}" value="${escapeHtml(state[key])}" placeholder="${placeholder}" />
    </label>
  `
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

function renderClient(client: Client, selected: boolean): string {
  return `
    <article class="record client-card ${selected ? 'client-card-selected' : ''}">
      <div class="record-head client-card-head">
        <label class="client-select">
          <input type="checkbox" data-client-select="${escapeHtml(clientSelectionKey(client))}" ${selected ? 'checked' : ''} />
          <strong>${escapeHtml(client.platform)}</strong>
        </label>
        <span>${escapeHtml(formatTime(client.lastSeenAt))}</span>
      </div>
      <p>${escapeHtml(client.appId)}</p>
      <dl>
        <div><dt>deviceId</dt><dd>${escapeHtml(client.deviceId)}</dd></div>
        <div><dt>sessionId</dt><dd>${escapeHtml(client.sessionId)}</dd></div>
        <div><dt>callbackEndpoint</dt><dd>${escapeHtml(client.callbackEndpoint)}</dd></div>
        <div><dt>ttlSeconds</dt><dd>${escapeHtml(String(client.ttlSeconds))}</dd></div>
        <div><dt>sdk</dt><dd>${escapeHtml([client.sdkName, client.sdkVersion].filter(Boolean).join(' ') || '-')}</dd></div>
      </dl>
    </article>
  `
}

function renderWsInboxItem(item: { timestamp: string; topic: string; message: string }): string {
  return `
    <article class="record ws-item">
      <div class="record-head">
        <strong>${escapeHtml(item.topic)}</strong>
        <span>${escapeHtml(formatTime(item.timestamp))}</span>
      </div>
      <p>${escapeHtml(item.message)}</p>
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
  document.querySelector('#ws-send-ping-button')?.addEventListener('click', () => sendPingCommand())
  document.querySelector('#clients-save-button')?.addEventListener('click', () => void submitSelectedClients())

  document.querySelectorAll<HTMLInputElement>('input[data-filter]').forEach((input) => {
    input.addEventListener('input', () => {
      const key = input.dataset.filter as keyof InspectorState['filters']
      setFilter(key, input.value)
    })
  })

  document.querySelectorAll<HTMLInputElement>('input[data-ws-target]').forEach((input) => {
    input.addEventListener('input', () => {
      const key = input.dataset.wsTarget as keyof Pick<InspectorState, 'wsTargetPlatforms' | 'wsTargetAppIds' | 'wsTargetSessionIds' | 'wsTargetDeviceIds'>
      if (!key) {
        return
      }
      setWsTargetField(key, input.value)
    })
  })

  document.querySelectorAll<HTMLInputElement>('input[data-client-select]').forEach((input) => {
    input.addEventListener('change', () => {
      const key = input.dataset.clientSelect
      if (!key) {
        return
      }
      setClientSelected(key, input.checked)
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

function initialize(): void {
  render()
  wsClient.start()
  void refreshAll()
}

initialize()
