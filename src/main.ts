import { buildLogsUrl, filterRecords, mergeRecords, normalizeBaseUrl, pollLogPage } from './logs'
import type { InspectorState, LogRecord } from './types'
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

function applyPage(records: LogRecord[], nextCursor: string | null): void {
  state.records = mergeRecords(state.records, records)
  state.nextCursor = nextCursor
  render()
}

async function loadOnce(): Promise<void> {
  setStatus('loading', null)
  try {
    const page = await fetchPage()
    applyPage(page.records, page.nextCursor)
    setStatus(`loaded ${page.records.length} records`, null)
  } catch (error) {
    setStatus('error', error instanceof Error ? error.message : String(error))
  }
}

async function fetchPage() {
  return pollLogPage(state.baseUrl, state.nextCursor, 0)
}

async function startPolling(): Promise<void> {
  if (state.isPolling) {
    return
  }
  state.isPolling = true
  setStatus('polling', null)

  const loop = async (): Promise<void> => {
    if (!state.isPolling) {
      return
    }
    try {
      const page = await pollLogPage(state.baseUrl, state.nextCursor, 1500)
      if (page.records.length > 0) {
        applyPage(page.records, page.nextCursor)
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
  render()
}

function render(): void {
  const visible = filterRecords(state.records, state.filters)
  app.innerHTML = `
    <main class="shell">
      <header class="hero">
        <div>
          <p class="eyebrow">NeptuneKit v2</p>
          <h1>H5 Inspector</h1>
          <p class="subtitle">连接 CLI gateway，查看并过滤结构化日志。</p>
        </div>
        <div class="status ${state.error ? 'status-error' : ''}">
          <span>${state.status}</span>
          <span>${state.error ?? state.baseUrl}</span>
        </div>
      </header>

      <section class="panel controls">
        <label>
          <span>Gateway BaseURL</span>
          <input id="base-url" value="${escapeHtml(state.baseUrl)}" placeholder="http://127.0.0.1:18765" />
        </label>
        <div class="actions">
          <button id="load-button">Load</button>
          <button id="poll-button">Start Poll</button>
          <button id="stop-button">Stop</button>
          <button id="clear-button" class="ghost">Clear</button>
        </div>
      </section>

      <section class="panel filters">
        ${renderFilterInput('platform', 'Platform')}
        ${renderFilterInput('appId', 'App ID')}
        ${renderFilterInput('sessionId', 'Session ID')}
        ${renderFilterInput('level', 'Level')}
      </section>

      <section class="panel summary">
        <div><strong>${state.records.length}</strong><span>Total</span></div>
        <div><strong>${visible.length}</strong><span>Visible</span></div>
        <div><strong>${state.nextCursor ?? '-'}</strong><span>Next Cursor</span></div>
      </section>

      <section class="panel list">
        <div class="list-header">
          <h2>Logs</h2>
          <code>${escapeHtml(buildLogsUrl(state.baseUrl, { afterId: state.nextCursor, waitMs: 1500, limit: 100 }))}</code>
        </div>
        <div class="records">
          ${visible.length > 0 ? visible.map(renderRecord).join('') : '<div class="empty">No logs yet.</div>'}
        </div>
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

function renderRecord(record: LogRecord): string {
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

  document.querySelector('#load-button')?.addEventListener('click', () => void loadOnce())
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

render()
