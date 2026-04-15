'use client'
import { useEffect, useState } from 'react'
import AppLayout from '../../components/AppLayout.js'
import { api } from '../../lib/api.js'
import { useToast } from '../../components/Toast.js'

export default function SystemPage() {
  const [status, setStatus] = useState(null)
  const [logs, setLogs] = useState([])
  const [tab, setTab] = useState('status')
  const [loading, setLoading] = useState(true)
  const toast = useToast()

  useEffect(() => {
    if (tab === 'status') api.systemStatus().then(setStatus).catch(console.error).finally(() => setLoading(false))
    else api.systemLogs().then(d => setLogs(d.logs || [])).catch(console.error).finally(() => setLoading(false))
  }, [tab])

  const clearLogs = async () => {
    if (!confirm('Clear all logs?')) return
    await api.clearLogs()
    setLogs([])
    toast.success('Logs cleared')
  }

  return (
    <AppLayout>
      <div className="page-header"><h1 className="page-title">System</h1></div>
      <div className="tabs">
        <button className={`tab${tab === 'status' ? ' active' : ''}`} onClick={() => setTab('status')}>Status</button>
        <button className={`tab${tab === 'logs' ? ' active' : ''}`} onClick={() => setTab('logs')}>Logs</button>
      </div>

      {tab === 'status' && status && (
        <div className="grid-2" style={{ maxWidth: 900 }}>
          <div className="card">
            <div className="card-title">Environment</div>
            <table className="table"><tbody>
              {[
                ['Environment', status.environment],
                ['Node Version', status.node_version],
                ['Platform', status.platform],
                ['Uptime', `${Math.floor(status.uptime / 60)}m`],
              ].map(([k, v]) => <tr key={k}><td className="text-muted">{k}</td><td>{v}</td></tr>)}
            </tbody></table>
          </div>
          <div className="card">
            <div className="card-title">Services</div>
            <table className="table"><tbody>
              {Object.entries(status.services || {}).map(([k, v]) => (
                <tr key={k}>
                  <td className="text-muted">{k}</td>
                  <td><span className={`badge ${v === 'connected' ? 'badge-published' : 'badge-failed'}`}>{v}</span></td>
                </tr>
              ))}
            </tbody></table>
            <div className="card-title" style={{ marginTop: '1rem' }}>Queue</div>
            <table className="table"><tbody>
              {Object.entries(status.queue || {}).map(([k, v]) => (
                <tr key={k}><td className="text-muted">{k}</td><td>{v}</td></tr>
              ))}
            </tbody></table>
          </div>
        </div>
      )}

      {tab === 'logs' && (
        <div className="card">
          <div className="flex items-center justify-between" style={{ marginBottom: '1rem' }}>
            <div className="card-title" style={{ margin: 0 }}>Application Logs</div>
            <button className="btn btn-danger btn-sm" onClick={clearLogs}>Clear Logs</button>
          </div>
          <div style={{ background: '#0f172a', borderRadius: 8, padding: '1rem', fontFamily: 'monospace', fontSize: '0.8125rem', color: '#94a3b8', maxHeight: 500, overflow: 'auto' }}>
            {logs.length ? logs.map((l, i) => <div key={i} style={{ marginBottom: '0.25rem' }}>{l}</div>) : <div className="text-muted">No logs</div>}
          </div>
        </div>
      )}
    </AppLayout>
  )
}
