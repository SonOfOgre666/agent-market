'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import AppLayout from '../../components/AppLayout.js'
import { api } from '../../lib/api.js'
import { useToast } from '../../components/Toast.js'
import { format } from 'date-fns'

const STATUS_BADGE = { 0: 'badge-draft', 1: 'badge-scheduled', 2: 'badge-published', 3: 'badge-failed' }
const STATUS_LABEL = { 0: 'Draft', 1: 'Scheduled', 2: 'Published', 3: 'Failed' }
const STATUSES = [null, 0, 1, 2, 3]

export default function PostsPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState(null)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState([])
  const toast = useToast()

  const load = async () => {
    setLoading(true)
    try {
      const params = { page, per_page: 15 }
      if (status !== null) params.status = status
      const d = await api.posts(params)
      setData(d)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [status, page])

  const duplicate = async (post) => {
    try {
      await api.duplicatePost(post.id)
      toast.success('Post duplicated')
      load()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const deleteSelected = async () => {
    if (!selected.length) return
    if (!confirm(`Delete ${selected.length} post(s)?`)) return
    try {
      await api.deletePosts(selected)
      setSelected([])
      load()
      toast.success('Posts deleted')
    } catch (err) {
      toast.error(err.message)
    }
  }

  const toggleSelect = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])

  const originalContent = (post) => {
    const orig = post.versions?.find(v => v.is_original)
    const block = orig?.content?.find(b => b.type === 'text')
    return block?.body || '(no text)'
  }

  return (
    <AppLayout>
      <div className="page-header">
        <h1 className="page-title">Posts</h1>
        <div className="flex gap-2">
          {selected.length > 0 && <button className="btn btn-danger btn-sm" onClick={deleteSelected}>Delete ({selected.length})</button>}
          <Link href="/posts/ai" className="btn btn-secondary" style={{ background: 'linear-gradient(135deg, hsl(262 68% 60% / 0.18), hsl(152 68% 50% / 0.12))', borderColor: 'hsl(262 68% 60% / 0.4)' }}>✨ AI Create</Link>
          <Link href="/posts/new" className="btn btn-primary">+ New Post</Link>
        </div>
      </div>

      {/* Status filter */}
      <div className="tabs">
        {STATUSES.map(s => (
          <button key={String(s)} className={`tab${status === s ? ' active' : ''}`} onClick={() => { setStatus(s); setPage(1) }}>
            {s === null ? 'All' : STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 64, borderRadius: 8 }} />)}
        </div>
      ) : !data?.items?.length ? (
        <div className="empty-state">
          <div className="empty-icon">✎</div>
          <div className="empty-title">No posts yet</div>
          <div className="empty-desc">Create your first post to get started</div>
          <Link href="/posts/new" className="btn btn-primary">Create Post</Link>
        </div>
      ) : (
        <>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 40 }}></th>
                <th>Content</th>
                <th>Status</th>
                <th>Scheduled</th>
                <th>Accounts</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map(post => (
                <tr key={post.id}>
                  <td>
                    <input type="checkbox" checked={selected.includes(post.id)} onChange={() => toggleSelect(post.id)} />
                  </td>
                  <td className="truncate" style={{ maxWidth: 300 }}>{originalContent(post)}</td>
                  <td><span className={`badge ${STATUS_BADGE[post.status]}`}>{STATUS_LABEL[post.status]}</span></td>
                  <td className="text-sm text-muted">{post.scheduled_at ? format(new Date(post.scheduled_at), 'MMM d, HH:mm') : '—'}</td>
                  <td className="text-sm text-muted">{post.account_ids?.length || 0} account(s)</td>
                  <td>
                    <div className="flex gap-2">
                      <Link href={`/posts/${post.id}`} className="btn btn-ghost btn-sm">Edit</Link>
                      <button className="btn btn-ghost btn-sm" onClick={() => duplicate(post)} title="Duplicate as draft">⧉</button>
                      {post.status === 2 && (
                        <Link href={`/posts/${post.id}/accounts`} className="btn btn-ghost btn-sm" title="View publish results">↗</Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {data.last_page > 1 && (
            <div className="pagination">
              <button className="page-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
              {Array.from({ length: data.last_page }, (_, i) => i + 1).map(p => (
                <button key={p} className={`page-btn${p === page ? ' active' : ''}`} onClick={() => setPage(p)}>{p}</button>
              ))}
              <button className="page-btn" disabled={page === data.last_page} onClick={() => setPage(p => p + 1)}>›</button>
            </div>
          )}
        </>
      )}
    </AppLayout>
  )
}
