'use client'
import { useEffect, useState } from 'react'
import AppLayout from '../components/AppLayout.js'
import { api } from '../lib/api.js'
import Link from 'next/link'

const STATUS_LABEL = { 0: 'Draft', 1: 'Scheduled', 2: 'Published', 3: 'Failed' }
const STATUS_BADGE = { 0: 'badge-draft', 1: 'badge-scheduled', 2: 'badge-published', 3: 'badge-failed' }
const PROVIDER_ICON = { twitter: '𝕏', facebook: 'f', instagram: '⊙', mastodon: 'M' }

export default function DashboardPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.dashboard().then(setData).catch(console.error).finally(() => setLoading(false))
  }, [])

  if (loading) return <AppLayout><div className="skeleton" style={{ height: 200, borderRadius: 12 }} /></AppLayout>

  return (
    <AppLayout>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <Link href="/posts/new" className="btn btn-primary">+ New Post</Link>
      </div>

      {/* Stats */}
      <div className="grid-4" style={{ marginBottom: '1.5rem' }}>
        {[
          { label: 'Total Posts', value: data?.stats?.total_posts ?? 0 },
          { label: 'Scheduled', value: data?.stats?.scheduled ?? 0 },
          { label: 'Published', value: data?.stats?.published ?? 0 },
          { label: 'Failed', value: data?.stats?.failed ?? 0 },
        ].map(s => (
          <div key={s.label} className="card stat-card">
            <div className="stat-value">{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Connected accounts */}
      <div className="card">
        <div className="card-title">Connected Accounts</div>
        {(!data?.accounts?.length) ? (
          <div className="empty-state" style={{ padding: '2rem' }}>
            <div className="empty-title">No accounts connected</div>
            <Link href="/accounts" className="btn btn-primary btn-sm">Connect Account</Link>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {data.accounts.map(acc => (
              <div key={acc.id} className="flex items-center gap-3">
                {acc.media?.avatar
                  ? <img src={acc.media.avatar} alt="" className="avatar" />
                  : <div className={`avatar provider-${acc.provider}`}>{PROVIDER_ICON[acc.provider]}</div>}
                <div>
                  <div style={{ fontWeight: 500 }}>{acc.name}</div>
                  <div className="text-muted text-xs">@{acc.username} · {acc.provider}</div>
                </div>
                <span className={`badge ${acc.authorized ? 'badge-published' : 'badge-failed'}`} style={{ marginLeft: 'auto' }}>
                  {acc.authorized ? 'Active' : 'Unauthorized'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  )
}
