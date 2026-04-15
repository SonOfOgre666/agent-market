'use client'
import { useEffect, useState } from 'react'
import AppLayout from '../../../components/AppLayout.js'
import { api } from '../../../lib/api.js'
import { useToast } from '../../../components/Toast.js'

export default function LeadsPage() {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const toast = useToast()

  const load = async (p = 1) => {
    setLoading(true)
    try {
      const res = await api.leads({ page: p, per_page: 30 })
      setItems(res.items || [])
      setTotal(res.total || 0)
      setLastPage(res.last_page || 1)
      setPage(p)
    } catch (e) { toast.error(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const exportCsv = () => {
    if (!items.length) return
    // Build CSV from all unique data keys
    const dataKeys = [...new Set(items.flatMap(l => Object.keys(l.data || {})))]
    const utmKeys = [...new Set(items.flatMap(l => Object.keys(l.utm || {})))]
    const headers = ['Date', ...dataKeys, 'Landing Page', 'Campaign', ...utmKeys.map(k => `utm_${k}`)]
    const rows = items.map(l => [
      new Date(l.created_at).toLocaleString(),
      ...dataKeys.map(k => l.data?.[k] || ''),
      l.landing_page_slug || '',
      l.campaign_id || '',
      ...utmKeys.map(k => l.utm?.[k] || ''),
    ])
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  // Collect unique data field keys to build table columns
  const dataKeys = [...new Set(items.flatMap(l => Object.keys(l.data || {})))]

  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <h1 className="page-title">Leads</h1>
          <p style={{ color: 'var(--fg-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>{total} lead{total !== 1 ? 's' : ''} captured</p>
        </div>
        <button className="btn btn-secondary" onClick={exportCsv} disabled={!items.length}>Export CSV</button>
      </div>

      {loading ? (
        <div className="skeleton" style={{ height: 300 }} />
      ) : items.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--fg-muted)' }}>
          No leads yet. Publish a landing page to start capturing leads.
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: 0, overflow: 'hidden', overflowX: 'auto' }}>
            <table className="table" style={{ margin: 0, minWidth: 700 }}>
              <thead>
                <tr>
                  <th>Date</th>
                  {dataKeys.map(k => <th key={k} style={{ textTransform: 'capitalize' }}>{k}</th>)}
                  <th>Source Page</th>
                  <th>UTM Source</th>
                  <th>UTM Campaign</th>
                </tr>
              </thead>
              <tbody>
                {items.map(l => (
                  <tr key={l.id}>
                    <td style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{new Date(l.created_at).toLocaleString()}</td>
                    {dataKeys.map(k => <td key={k}>{l.data?.[k] || '—'}</td>)}
                    <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{l.landing_page_slug || '—'}</td>
                    <td style={{ fontSize: '0.75rem' }}>{l.utm?.source || '—'}</td>
                    <td style={{ fontSize: '0.75rem' }}>{l.utm?.campaign || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {lastPage > 1 && (
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginTop: '1rem' }}>
              <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => load(page - 1)}>← Prev</button>
              <span style={{ padding: '0.4rem 0.75rem', fontSize: '0.875rem', color: 'var(--fg-muted)' }}>Page {page} of {lastPage}</span>
              <button className="btn btn-secondary btn-sm" disabled={page >= lastPage} onClick={() => load(page + 1)}>Next →</button>
            </div>
          )}
        </>
      )}
    </AppLayout>
  )
}
