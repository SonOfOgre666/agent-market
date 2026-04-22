'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import AppLayout from '../../../../components/AppLayout.js'
import { api } from '../../../../lib/api.js'
import { useToast } from '../../../../components/Toast.js'

const PROVIDER_COLOR = {
  facebook: '#1877f2', instagram: '#e1306c', instagram_login: '#c13584',
  twitter: '#1d9bf0', tiktok: '#ff0050', linkedin: '#0a66c2',
  google_ads: '#4285f4',
}

const PROVIDER_LABEL = {
  facebook: 'Facebook', instagram: 'Instagram', instagram_login: 'Instagram',
  twitter: 'Twitter / X', tiktok: 'TikTok', linkedin: 'LinkedIn',
  google_ads: 'Google Ads',
}

function timeAgo(date) {
  if (!date) return '—'
  const secs = Math.floor((Date.now() - new Date(date)) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return new Date(date).toLocaleDateString()
}

export default function PostAccountsPage() {
  const { id } = useParams()
  const router = useRouter()
  const toast = useToast()
  const [post, setPost] = useState(null)
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.post(id),
      api.get(`/posts/${id}/accounts`),
    ])
      .then(([postData, accountResults]) => {
        setPost(postData?.post || postData)
        setResults(accountResults || [])
      })
      .catch(err => { toast.error(err.message); router.push('/posts') })
      .finally(() => setLoading(false))
  }, [id])

  const originalText = () => {
    const orig = post?.versions?.find(v => v.is_original)
    return orig?.content?.find(b => b.type === 'text')?.body || ''
  }

  const successCount = results.filter(r => r.success).length
  const failCount = results.filter(r => !r.success).length

  if (loading) {
    return (
      <AppLayout>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="skeleton" style={{ height: 80, borderRadius: 12 }} />
          {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 72, borderRadius: 12 }} />)}
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
            <Link href="/posts" className="btn btn-ghost btn-sm">← Posts</Link>
            <h1 className="page-title" style={{ margin: 0 }}>Publish Results</h1>
          </div>
          {post && (
            <p style={{ color: 'var(--fg-muted)', fontSize: '0.8rem', maxWidth: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {originalText().slice(0, 120) || '(no text)'}
            </p>
          )}
        </div>
        <Link href={`/posts/${id}`} className="btn btn-secondary btn-sm">Edit Post</Link>
      </div>

      {/* Summary */}
      <div className="grid-4" style={{ marginBottom: '1.5rem' }}>
        <div className="card stat-card">
          <div className="stat-value">{results.length}</div>
          <div className="stat-label">Accounts targeted</div>
        </div>
        <div className="card stat-card">
          <div className="stat-value" style={{ color: '#10b981' }}>{successCount}</div>
          <div className="stat-label">Published</div>
        </div>
        <div className="card stat-card">
          <div className="stat-value" style={{ color: failCount > 0 ? '#ef4444' : 'var(--fg-muted)' }}>{failCount}</div>
          <div className="stat-label">Failed</div>
        </div>
        <div className="card stat-card">
          <div className="stat-value" style={{ color: results.length > 0 ? (successCount === results.length ? '#10b981' : '#f59e0b') : 'var(--fg-muted)' }}>
            {results.length > 0 ? `${Math.round((successCount / results.length) * 100)}%` : '—'}
          </div>
          <div className="stat-label">Success rate</div>
        </div>
      </div>

      {results.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--fg-muted)' }}>
          No publish results yet. Results appear once the post has been processed by the scheduler.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {results.map((r, i) => {
            const color = PROVIDER_COLOR[r.account?.provider] || '#6366f1'
            const label = PROVIDER_LABEL[r.account?.provider] || r.account?.provider || 'Unknown'
            return (
              <div key={i} className="card card-sm" style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', borderLeft: `4px solid ${r.success ? '#10b981' : '#ef4444'}` }}>
                {/* Avatar */}
                {r.account?.media?.avatar
                  ? <img src={r.account.media.avatar} style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0 }} alt="" />
                  : <div style={{ width: 40, height: 40, borderRadius: '50%', background: color + '22', color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0 }}>
                      {(r.account?.name || label)[0]}
                    </div>
                }

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600 }}>{r.account?.name || 'Unknown account'}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--fg-muted)' }}>@{r.account?.username}</span>
                    <span style={{ fontSize: '0.7rem', background: color + '22', color, padding: '0.1rem 0.4rem', borderRadius: 4, fontWeight: 500 }}>{label}</span>
                  </div>

                  {r.success ? (
                    <div style={{ marginTop: '0.375rem', fontSize: '0.8rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span>✓ Published successfully</span>
                      {r.provider_post_id && (
                        <span style={{ color: 'var(--fg-muted)' }}>· ID: {r.provider_post_id}</span>
                      )}
                    </div>
                  ) : (
                    <div style={{ marginTop: '0.375rem' }}>
                      <div style={{ fontSize: '0.8rem', color: '#ef4444', marginBottom: '0.25rem' }}>✕ Failed to publish</div>
                      {r.errors?.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                          {r.errors.map((err, j) => (
                            <div key={j} style={{ fontSize: '0.75rem', color: '#fca5a5', background: 'rgba(239,68,68,0.08)', borderRadius: 6, padding: '0.3rem 0.6rem' }}>
                              {typeof err === 'string' ? err : (err.message || JSON.stringify(err))}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Status badge */}
                <span style={{
                  flexShrink: 0, fontSize: '0.7rem', fontWeight: 700,
                  padding: '0.25rem 0.6rem', borderRadius: 6,
                  background: r.success ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                  color: r.success ? '#10b981' : '#ef4444',
                }}>
                  {r.success ? 'Published' : 'Failed'}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </AppLayout>
  )
}
