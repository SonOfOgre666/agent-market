'use client'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '../components/AppLayout.js'
import { api } from '../lib/api.js'
import Link from 'next/link'
import {
  LayoutDashboard, BarChart3, FileText, CheckCircle2, AlertCircle,
} from 'lucide-react'
import { accountProviderLabel } from '../lib/accountKinds.js'
import { AccountAvatar } from '../components/AccountAvatar.js'

const STATUS_BADGE = { 0: 'badge-draft', 1: 'badge-scheduled', 2: 'badge-published', 3: 'badge-failed' }
const STATUS_LABEL = { 0: 'Draft', 1: 'Scheduled', 2: 'Published', 3: 'Failed' }

function postPreview(post) {
  const orig = post.versions?.find((v) => v.is_original)
  return orig?.content?.find((b) => b.type === 'text')?.body || '(no text)'
}

function postLink(post) {
  if (post.status === 2) return `/posts/${post.id}/accounts?section=engagement`
  if (post.status === 3) return `/posts/${post.id}/accounts`
  return `/posts/${post.id}`
}

export default function DashboardPage() {
  const [data, setData] = useState(null)
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const [dash, postRes] = await Promise.all([
        api.dashboard(),
        api.posts({ per_page: 5 }),
      ])
      setData(dash)
      setPosts(postRes?.items || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  if (loading) return <AppLayout><div className="skeleton" style={{ height: 200, borderRadius: 12 }} /></AppLayout>

  return (
    <AppLayout>
      <div className="page-header-enhanced">
        <div className="page-header-content">
          <div className="page-header-title">
            <div className="page-header-icon">
              <LayoutDashboard size={18} strokeWidth={2.5} />
            </div>
            <h1 className="page-title">Overview</h1>
          </div>
          <p className="page-header-desc">
            Workspace pulse — post activity and connected accounts.
          </p>
        </div>
        <Link href="/posts/new" className="btn btn-primary">+ New Post</Link>
      </div>

      <div className="grid-4" style={{ marginBottom: '1.5rem' }}>
        {[
          { label: 'Total Posts', value: data?.stats?.total_posts ?? 0, icon: FileText, color: 'var(--info)' },
          { label: 'Scheduled', value: data?.stats?.scheduled ?? 0, icon: BarChart3, color: 'var(--warning)' },
          { label: 'Published', value: data?.stats?.published ?? 0, icon: CheckCircle2, color: 'var(--success)' },
          { label: 'Failed', value: data?.stats?.failed ?? 0, icon: AlertCircle, color: 'var(--danger)' },
        ].map((s) => (
          <div key={s.label} className="card stat-card">
            <div className="stat-with-icon">
              <div className="stat-icon" style={{ background: s.color + '15' }}>
                <s.icon size={18} color={`hsl(${s.color})`} strokeWidth={2} />
              </div>
              <div>
                <div className="stat-value">{s.value}</div>
                <div className="stat-label">{s.label}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid-2" style={{ alignItems: 'start', gap: '1.5rem', marginBottom: '1.5rem' }}>
        <div className="card">
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FileText size={16} /> Recent posts
          </div>
          {!posts.length ? (
            <p className="text-muted text-sm">No posts yet. <Link href="/posts/new">Create a post</Link></p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {posts.map((p) => (
                <li key={p.id} style={{ padding: '0.5rem 0', borderBottom: '1px solid hsl(var(--border))' }}>
                  <Link href={postLink(p)} style={{ fontWeight: 500, fontSize: '0.875rem' }}>
                    {postPreview(p).slice(0, 60)}{postPreview(p).length > 60 ? '…' : ''}
                  </Link>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <span className={`badge ${STATUS_BADGE[p.status] || 'badge-draft'}`}>
                      {STATUS_LABEL[p.status] ?? 'Unknown'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Link href="/posts" className="btn btn-ghost btn-sm" style={{ marginTop: '0.75rem' }}>All posts</Link>
        </div>

        <div className="card">
          <div className="card-title">Connected Accounts</div>
          {(!data?.accounts?.length) ? (
            <div className="empty-state" style={{ padding: '2rem' }}>
              <div className="empty-title">No accounts connected</div>
              <Link href="/accounts" className="btn btn-primary btn-sm">Connect Account</Link>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {data.accounts.map((acc) => (
                <div key={acc.id} className="flex items-center gap-3">
                  <AccountAvatar account={acc} />
                  <div>
                    <div style={{ fontWeight: 500 }}>{acc.name}</div>
                    <div className="text-muted text-xs">
                      @{acc.username || '—'} · {accountProviderLabel(acc.provider)}
                    </div>
                  </div>
                  <span className={`badge ${acc.authorized ? 'badge-published' : 'badge-failed'}`} style={{ marginLeft: 'auto' }}>
                    {acc.authorized ? 'Active' : 'Unauthorized'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
