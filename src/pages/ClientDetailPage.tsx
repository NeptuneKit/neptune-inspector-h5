import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { decodeClientKey } from '../features/clients/clientKey'

export function ClientDetailPage() {
  const { clientKey = '' } = useParams()
  const identity = useMemo(() => decodeClientKey(clientKey), [clientKey])

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
            <span className="meta-chip"><span className="meta-key">platform</span><span className="meta-val">{identity.platform}</span></span>
            <span className="meta-chip"><span className="meta-key">app</span><span className="meta-val">{identity.appId}</span></span>
            <span className="meta-chip"><span className="meta-key">session</span><span className="meta-val">{identity.sessionId}</span></span>
            <span className="meta-chip"><span className="meta-key">device</span><span className="meta-val">{identity.deviceId}</span></span>
          </div>
        </div>
      </header>

      <section className="dashboard-sections" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem', marginTop: '1rem' }}>
        <Link to={`/clients/${clientKey}/logs`} className="panel" style={{ textDecoration: 'none', padding: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', transition: 'transform 0.2s', cursor: 'pointer' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📜</div>
          <h2 style={{ marginBottom: '0.5rem', color: 'var(--text)' }}>日志流</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>查看实时的终端日志输出，支持筛选与自动滚动。</p>
        </Link>

        <Link to={`/clients/${clientKey}/views`} className="panel" style={{ textDecoration: 'none', padding: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', transition: 'transform 0.2s', cursor: 'pointer' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🌳</div>
          <h2 style={{ marginBottom: '0.5rem', color: 'var(--text)' }}>视图树</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>检查当前的 UI 布局结构与组件属性详情。</p>
        </Link>
      </section>
    </main>
  )
}
