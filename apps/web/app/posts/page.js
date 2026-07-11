'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import AppLayout from '../../components/AppLayout.js'
import NewPostWizard from '../../components/NewPostWizard.js'
import { api } from '../../lib/api.js'
import { useToast } from '../../components/Toast.js'
import { useWorkspaceSettings } from '../../components/WorkspaceSettingsProvider.js'
import { useConfirmDialog } from '../../lib/useConfirmDialog.js'
import {
  FileText, Plus, Sparkles, Pencil, Copy, ExternalLink, Trash2,
  ChevronLeft, ChevronRight, X as XIcon,
} from 'lucide-react'

const STATUS_BADGE = { 0: 'badge-draft', 1: 'badge-scheduled', 2: 'badge-published', 3: 'badge-failed' }
const STATUS_LABEL = { 0: 'Draft', 1: 'Scheduled', 2: 'Published', 3: 'Failed' }
const STATUSES     = [null, 0, 1, 2, 3]

function displayStatus(post) {
  if (post.status === 2 && post.publish_summary?.partial) {
    return { label: 'Partially published', badge: 'badge-scheduled' }
  }
  return { label: STATUS_LABEL[post.status], badge: STATUS_BADGE[post.status] }
}

export default function PostsPage() {
  const router = useRouter()
  const { formatDateTime } = useWorkspaceSettings()

  // ── List state ──────────────────────────────────────────────────────────────
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(true)
  const [status, setStatus]     = useState(null)
  const [page, setPage]         = useState(1)
  const [selected, setSelected] = useState([])

  // ── Modal state ─────────────────────────────────────────────────────────────
  const [showWizard, setShowWizard] = useState(false)

  const toast = useToast()
  const { confirm, ConfirmDialogHost } = useConfirmDialog()

  // ── List logic ──────────────────────────────────────────────────────────────
  const load = async () => {
    setLoading(true)
    try {
      const params = { page, per_page: 15 }
      if (status !== null) params.status = status
      setData(await api.posts(params))
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [status, page])

  const duplicate = async (post) => {
    try { await api.duplicatePost(post.id); toast.success('Post duplicated'); load() }
    catch (err) { toast.error(err.message) }
  }

  const deleteSelected = async () => {
    if (!selected.length) return
    const ok = await confirm({
      title: 'Delete posts?',
      message: `Delete ${selected.length} post(s)? This cannot be undone.`,
      confirmLabel: 'Delete',
    })
    if (!ok) return
    try { await api.deletePosts(selected); setSelected([]); load(); toast.success('Posts deleted') }
    catch (err) { toast.error(err.message) }
  }

  const toggleSelect = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])

  const originalContent = (post) => {
    const orig = post.versions?.find(v => v.is_original)
    return orig?.content?.find(b => b.type === 'text')?.body || '(no text)'
  }

  // ── Modal openers ───────────────────────────────────────────────────────────
  const openWizard = () => setShowWizard(true)

  const onWizardDone = () => {
    setShowWizard(false)
    load()
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      {/* ── Page header ── */}
      <div className="page-header-enhanced">
        <div className="page-header-content">
          <div className="page-header-title">
            <div className="page-header-icon"><FileText size={18} strokeWidth={2.5} /></div>
            <h1 className="page-title">Posts</h1>
          </div>
          <p className="page-header-desc">Manage and schedule your social media posts</p>
        </div>
        <div className="flex gap-2">
          {selected.length > 0 && (
            <button className="btn btn-danger btn-sm" onClick={deleteSelected}>
              <Trash2 size={12} /> Delete ({selected.length})
            </button>
          )}
          <button className="btn btn-primary" onClick={openWizard}>
            <Plus size={14} strokeWidth={2.5} /> New Post
          </button>
        </div>
      </div>

      {/* ── Status filter ── */}
      <div className="tabs">
        {STATUSES.map(s => (
          <button
            key={String(s)}
            className={`tab${status === s ? ' active' : ''}`}
            onClick={() => { setStatus(s); setPage(1) }}
          >
            {s === null ? 'All' : STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {/* ── Post list ── */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 64, borderRadius: 8 }} />)}
        </div>
      ) : !data?.items?.length ? (
        <div className="empty-state-enhanced">
          <div className="empty-state-icon"><FileText size={32} strokeWidth={1.5} /></div>
          <div className="empty-state-title">No posts yet</div>
          <div className="empty-state-desc">Create your first post to get started</div>
          <div style={{ display: 'flex', gap: '0.625rem' }}>
            <button className="btn btn-primary" onClick={openWizard}>
              <Plus size={14} strokeWidth={2.5} /> New Post
            </button>
          </div>
        </div>
      ) : (
        <>
          <table className="table table-hover-lift">
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
                    <input
                      type="checkbox"
                      checked={selected.includes(post.id)}
                      onChange={() => toggleSelect(post.id)}
                    />
                  </td>
                  <td className="truncate" style={{ maxWidth: 300 }}>{originalContent(post)}</td>
                  <td>
                    {(() => {
                      const statusDisplay = displayStatus(post)
                      return <span className={`badge ${statusDisplay.badge}`}>{statusDisplay.label}</span>
                    })()}
                  </td>
                  <td className="text-sm text-muted">
                    {post.scheduled_at ? formatDateTime(post.scheduled_at) : '—'}
                  </td>
                  <td className="text-sm text-muted">{post.account_ids?.length || 0} account(s)</td>
                  <td>
                    <div className="flex gap-2">
                      <Link href={`/posts/${post.id}`} className="btn btn-ghost btn-sm">
                        <Pencil size={12} strokeWidth={2} /> Edit
                      </Link>
                      <button className="btn btn-ghost btn-sm" onClick={() => duplicate(post)} title="Duplicate">
                        <Copy size={12} strokeWidth={2} />
                      </button>
                      {post.status === 2 && (
                        <Link href={`/posts/${post.id}/accounts`} className="btn btn-ghost btn-sm" title="Publish results">
                          <ExternalLink size={12} strokeWidth={2} />
                        </Link>
                      )}
                      {post.status === 3 && (
                        <Link href={`/posts/${post.id}/accounts`} className="btn btn-ghost btn-sm" title="Why publish failed">
                          <ExternalLink size={12} strokeWidth={2} />
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {data.last_page > 1 && (
            <div className="pagination">
              <button className="page-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft size={14} strokeWidth={2} />
              </button>
              {Array.from({ length: data.last_page }, (_, i) => i + 1).map(p => (
                <button key={p} className={`page-btn${p === page ? ' active' : ''}`} onClick={() => setPage(p)}>
                  {p}
                </button>
              ))}
              <button className="page-btn" disabled={page === data.last_page} onClick={() => setPage(p => p + 1)}>
                <ChevronRight size={14} strokeWidth={2} />
              </button>
            </div>
          )}
        </>
      )}

      {/* ── New Post Wizard ─────────────────────────────────────────────────── */}
      {showWizard && (
        <div
          className="modal-overlay"
          style={{ zIndex: 1100, alignItems: 'flex-start', padding: '1rem' }}
          onClick={e => { if (e.target === e.currentTarget) setShowWizard(false) }}
        >
          <div
            className="modal animate-fade-in-up"
            style={{
              maxWidth: 720,
              width: '100%',
              height: '92vh',
              maxHeight: '92vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              padding: 0,
            }}
          >
            <div style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.75rem 1.25rem',
              borderBottom: '1px solid hsl(var(--border)/0.6)',
              background: 'hsl(var(--surface))',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 'var(--radius)',
                  background: 'linear-gradient(135deg, hsl(262 68% 60% / 0.2), hsl(221 83% 53% / 0.15))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Sparkles size={13} color="hsl(262 68% 68%)" strokeWidth={2} />
                </div>
                <div>
                  <div style={{ fontSize: '0.875rem', fontWeight: 700 }}>Create post</div>
                  <div style={{ fontSize: '0.68rem', color: 'hsl(var(--fg-muted))' }}>Agent-style workflow — type → content → media → publish</div>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowWizard(false)} style={{ padding: '0.375rem' }}>
                <XIcon size={16} />
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <NewPostWizard
                onClose={() => setShowWizard(false)}
                onDone={onWizardDone}
              />
            </div>
          </div>
        </div>
      )}
      <ConfirmDialogHost />
    </AppLayout>
  )
}
