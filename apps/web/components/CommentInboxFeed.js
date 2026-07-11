'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { api } from '../lib/api.js'
import { useToast } from './Toast.js'
import { useWorkspaceSettings } from './WorkspaceSettingsProvider.js'
import { SENTIMENT_STYLE, PROVIDER_LABEL, PROVIDER_COLOR, commentSyncSupportedLabel } from '../lib/commentUi.js'
import CommentPlatformSupportNote from './CommentPlatformSupportNote.js'
import { MessageSquare, RefreshCw, ArrowRight } from 'lucide-react'

function formatWhen(iso, formatDateTime) {
  if (!iso) return ''
  try {
    return formatDateTime(iso)
  } catch {
    return iso
  }
}

function needsReply(c) {
  const replyStatus = c.reply?.status || 'none'
  return c.reply_supported !== false
    && c.provider_comment_id
    && replyStatus !== 'sent'
    && replyStatus !== 'pending'
}

function isUrgent(c) {
  const u = c.analysis?.urgency
  return u === 'high' || u === 'medium'
}

export default function CommentInboxFeed({ limit = 12, showSyncAll = true }) {
  const toast = useToast()
  const { settings, formatDateTime } = useWorkspaceSettings()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const out = await api.socialComments({ limit, synced_only: '1' })
      setItems(out.items || [])
    } catch (err) {
      toast.error(err.message || 'Failed to load comments')
    } finally {
      setLoading(false)
    }
  }, [limit, toast])

  useEffect(() => {
    load()
    const onRefresh = () => load()
    window.addEventListener('inbox:refresh', onRefresh)
    return () => window.removeEventListener('inbox:refresh', onRefresh)
  }, [load])

  const stats = useMemo(() => ({
    total: items.length,
    needsReply: items.filter(needsReply).length,
    urgent: items.filter(isUrgent).length,
    analyzing: items.filter((c) => settings.auto_analyze_comments && c.analysis?.analysis_status === 'pending').length,
  }), [items, settings.auto_analyze_comments])

  async function handleSyncAll() {
    setSyncing(true)
    try {
      const out = await api.syncAllPostComments()
      toast.success(`Sync queued for ${out.queued ?? 0} published post(s)`)
      setTimeout(load, 3000)
    } catch (err) {
      toast.error(err.message || 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <div>
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
            <MessageSquare size={16} /> Comment inbox
          </div>
          <p className="text-muted text-sm" style={{ margin: '6px 0 0', maxWidth: 520 }}>
            Triage synced comments from published posts. Analyze, propose replies, and respond on each post&apos;s{' '}
            <strong>Publish Results → Engagement</strong> tab.
            {settings.auto_analyze_comments ? ' Auto-analyze is on.' : (
              <>
                {' '}
                <Link href="/preferences" style={{ fontWeight: 600 }}>Enable auto-analyze</Link>
              </>
            )}
          </p>
        </div>
        {showSyncAll && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleSyncAll} disabled={syncing}>
            {syncing ? 'Syncing…' : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <RefreshCw size={12} /> Sync all published
              </span>
            )}
          </button>
        )}
      </div>

      {!loading && items.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: '0.75rem' }}>
          <span className="badge badge-draft">{stats.total} synced</span>
          {stats.needsReply > 0 && (
            <span className="badge badge-scheduled">{stats.needsReply} need reply</span>
          )}
          {stats.urgent > 0 && (
            <span className="badge badge-failed">{stats.urgent} urgent</span>
          )}
          {stats.analyzing > 0 && (
            <span className="badge badge-scheduled">{stats.analyzing} analyzing</span>
          )}
        </div>
      )}

      <div style={{ marginBottom: '0.75rem' }}>
        <CommentPlatformSupportNote variant="compact" />
      </div>

      {loading ? (
        <p className="text-muted text-sm">Loading comments…</p>
      ) : !items.length ? (
        <div
          style={{
            padding: '1.25rem',
            borderRadius: 10,
            background: 'hsl(var(--bg-alt) / 0.5)',
            border: '1px dashed hsl(var(--border))',
          }}
        >
          <p className="text-sm" style={{ margin: '0 0 10px', fontWeight: 600 }}>No comments in the inbox yet</p>
          <ol className="text-muted text-sm" style={{ margin: '0 0 12px', paddingLeft: '1.2rem', lineHeight: 1.6 }}>
            <li>Publish a post to {commentSyncSupportedLabel()}</li>
            <li>Open <strong>Publish Results → Engagement</strong> on that post</li>
            <li>Sync comments — AI analysis runs there (or automatically if enabled)</li>
          </ol>
          <Link href="/posts" className="btn btn-secondary btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            Go to posts <ArrowRight size={13} />
          </Link>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {items.map((c) => {
            const analysis = c.analysis || {}
            const sentiment = analysis.sentiment
              ? SENTIMENT_STYLE[analysis.sentiment] || SENTIMENT_STYLE.neutral
              : null
            const color = PROVIDER_COLOR[c.provider] || '#64748b'
            const postHref = c.post_id ? `/posts/${c.post_id}/accounts?section=engagement` : null
            const awaitingReply = needsReply(c)

            return (
              <li
                key={c.id}
                style={{
                  padding: '0.75rem 0',
                  borderBottom: '1px solid hsl(var(--border))',
                  fontSize: '0.82rem',
                  borderLeft: awaitingReply ? '3px solid #f59e0b' : undefined,
                  paddingLeft: awaitingReply ? 10 : 0,
                  marginLeft: awaitingReply ? -10 : 0,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: color,
                      flexShrink: 0,
                    }}
                  />
                  <span className="text-xs text-muted">
                    {PROVIDER_LABEL[c.provider] || c.provider}
                    {c.author ? ` · ${c.author}` : ''}
                    {c.platform_created_at ? ` · ${formatWhen(c.platform_created_at, formatDateTime)}` : ''}
                  </span>
                  {sentiment && (
                    <span className="badge" style={{ background: `${sentiment.color}22`, color: sentiment.color }}>
                      {sentiment.label}
                    </span>
                  )}
                  {analysis.urgency && analysis.urgency !== 'low' && (
                    <span className="badge badge-scheduled">{analysis.urgency}</span>
                  )}
                  {awaitingReply && <span className="badge badge-scheduled">Needs reply</span>}
                  {c.reply?.status === 'sent' && <span className="badge badge-published">Replied</span>}
                  {c.reply?.status === 'pending' && <span className="badge badge-scheduled">Replying…</span>}
                  {settings.auto_analyze_comments && analysis.analysis_status === 'pending' && (
                    <span className="badge badge-scheduled">Analyzing…</span>
                  )}
                </div>
                <p style={{ margin: '0 0 4px', lineHeight: 1.4 }}>
                  {c.comment.slice(0, 140)}{c.comment.length > 140 ? '…' : ''}
                </p>
                {analysis.summary && (
                  <p className="text-muted text-xs" style={{ margin: '0 0 6px' }}>{analysis.summary}</p>
                )}
                {postHref && (
                  <Link href={postHref} className="text-xs" style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    Open engagement <ArrowRight size={12} />
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
