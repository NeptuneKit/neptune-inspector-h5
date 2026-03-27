import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { normalizeBaseUrl } from '../api'
import { safeStorageGet, safeStorageSet } from '../storage'
import type { Client } from '../types'
import { encodeClientKey } from '../features/clients/clientKey'
import { fetchClientsSnapshot } from '../features/clients/clientService'
import { BASE_URL_STORAGE_KEY, DEFAULT_BASE_URL } from '../shared/constants'

export function ClientsPage() {
  const [baseUrl, setBaseUrl] = useState(() => normalizeBaseUrl(safeStorageGet(BASE_URL_STORAGE_KEY) ?? DEFAULT_BASE_URL))
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const title = useMemo(() => `Clients (${clients.length})`, [clients.length])

  async function loadClients() {
    setLoading(true)
    setError(null)
    try {
      const list = await fetchClientsSnapshot(baseUrl)
      setClients(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setClients([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    safeStorageSet(BASE_URL_STORAGE_KEY, normalizeBaseUrl(baseUrl))
  }, [baseUrl])

  useEffect(() => {
    loadClients()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl])

  return (
    <main className="page clients-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Neptune</p>
          <h1>客户端列表</h1>
        </div>
        <div className="toolbar">
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={DEFAULT_BASE_URL}
            aria-label="gateway-base-url"
          />
          <button onClick={loadClients}>刷新</button>
        </div>
      </header>

      <section className="panel">
        <div className="panel-title-row">
          <h2>{title}</h2>
          <span className="status-pill">{loading ? 'loading' : 'ready'}</span>
        </div>

        {error ? <div className="error-box">{error}</div> : null}

        {!loading && !error && clients.length === 0 ? <div className="empty">暂无客户端。</div> : null}

        <div className="client-list">
          {clients.map((client) => {
            const clientKey = encodeClientKey(client)
            return (
              <article key={clientKey} className="client-card">
                <div className="client-card-header">
                  <strong>{client.platform}</strong>
                  <p>{client.appId}</p>
                </div>
                <dl>
                  <div>
                    <dt>session</dt>
                    <dd>{client.sessionId}</dd>
                  </div>
                  <div>
                    <dt>device</dt>
                    <dd>{client.deviceId}</dd>
                  </div>
                  <div>
                    <dt>lastSeen</dt>
                    <dd>{client.lastSeenAt}</dd>
                  </div>
                </dl>
                <div className="actions-group" style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                  <Link className="link-btn" to={`/clients/${clientKey}`} style={{ flex: 1 }}>
                    进入详情
                  </Link>
                  <Link className="link-btn secondary" to={`/clients/${clientKey}/views`} style={{ flex: 1 }}>
                    视图信息
                  </Link>
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </main>
  )
}
