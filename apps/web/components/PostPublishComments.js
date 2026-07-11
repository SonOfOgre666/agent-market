'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { api } from '../lib/api.js'
import { useToast } from './Toast.js'
import { useWorkspaceSettings } from './WorkspaceSettingsProvider.js'
import {
  SENTIMENT_STYLE,
  PROVIDER_LABEL,
  PROVIDER_COLOR,
  commentSyncSupportedLabel,
  isCommentSyncSupported,
} from '../lib/commentUi.js'
import CommentPlatformSupportNote from './CommentPlatformSupportNote.js'
import {
  MessageSquare, RefreshCw, Sparkles, Send, Search, ChevronDown, ChevronUp,
  AlertTriangle, CheckCircle2, Clock, Filter,
} from 'lucide-react'

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'needs_reply', label: 'Needs reply' },
  { id: 'urgent', label: 'Urgent' },
  { id: 'analyzing', label: 'Analyzing' },
  { id: 'replied', label: 'Replied' },
]

const SORT_OPTIONS = [
  { id: 'newest', label: 'Newest first' },
  { id: 'urgency', label: 'Urgency' },
]

const URGENCY_RANK = { high: 0, medium: 1, low: 2 }

function formatWhen(iso, formatDateTime) {
  if (!iso) return ''
  try {
    return formatDateTime(iso)
  } catch {
    return iso
  }
}

function commentTimestamp(c) {
  return c.platform_created_at || c.created_at
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

function isAnalyzing(c, autoAnalyze) {
  return autoAnalyze === true && c.analysis?.analysis_status === 'pending'
}

function computeStats(items, autoAnalyze) {
  return {
    total: items.length,
    needsReply: items.filter(needsReply).length,
    urgent: items.filter(isUrgent).length,
    analyzing: items.filter((c) => isAnalyzing(c, autoAnalyze)).length,
    replied: items.filter((c) => c.reply?.status === 'sent').length,
  }
}

function countByProvider(items, publishAccounts) {
  const counts = {}
  for (const c of items) {
    const p = String(c.provider || 'unknown')
    counts[p] = (counts[p] || 0) + 1
  }
  const published = (publishAccounts || []).filter((r) => r.success && r.provider_post_id)
  for (const r of published) {
    const p = String(r.account?.provider || 'unknown')
    if (counts[p] === undefined) counts[p] = 0
  }
  return counts
}

export default function PostPublishComments({ postId, publishAccounts: publishAccountsProp = null }) {
  const toast = useToast()
  const { settings, formatDateTime } = useWorkspaceSettings()
  const [items, setItems] = useState([])
  const [publishAccounts, setPublishAccounts] = useState(publishAccountsProp || [])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [analyzingId, setAnalyzingId] = useState(null)
  const [replyDrafts, setReplyDrafts] = useState({})
  const [replyingId, setReplyingId] = useState(null)
  const [filter, setFilter] = useState('all')
  const [providerFilter, setProviderFilter] = useState('all')
  const [sort, setSort] = useState('newest')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState({})

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const fetches = [api.postComments(postId)]
      if (!publishAccountsProp) {
        fetches.push(api.postPublishAccounts(postId).catch(() => []))
      }
      const [commentsOut, accountsOut] = await Promise.all(fetches)
      setItems(commentsOut.items || [])
      if (!publishAccountsProp && accountsOut) {
        setPublishAccounts(accountsOut || [])
      }
    } catch (err) {
      if (!silent) toast.error(err.message || 'Failed to load comments')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [postId, publishAccountsProp, toast])

  useEffect(() => {
    if (publishAccountsProp) setPublishAccounts(publishAccountsProp)
  }, [publishAccountsProp])

  useEffect(() => {
    load()
    const onRefresh = () => load(true)
    window.addEventListener('inbox:refresh', onRefresh)
    return () => window.removeEventListener('inbox:refresh', onRefresh)
  }, [load])

  useEffect(() => {
    setExpanded((prev) => {
      const next = { ...prev }
      let changed = false
      for (const c of items) {
        if (c.analysis?.urgency === 'high' && prev[c.id] === undefined) {
          next[c.id] = true
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [items])

  const hasPendingWork = useMemo(
    () => items.some((c) => isAnalyzing(c, settings.auto_analyze_comments) || c.reply?.status === 'pending'),
    [items, settings.auto_analyze_comments],
  )

  useEffect(() => {
    if (!hasPendingWork) return undefined
    const t = setInterval(() => load(true), 8000)
    return () => clearInterval(t)
  }, [hasPendingWork, load])

  const stats = useMemo(() => computeStats(items, settings.auto_analyze_comments), [items, settings.auto_analyze_comments])
  const providerCounts = useMemo(() => countByProvider(items, publishAccounts), [items, publishAccounts])

  const providerOptions = useMemo(() => {
    const keys = Object.keys(providerCounts).sort()
    return keys.map((p) => ({
      id: p,
      label: PROVIDER_LABEL[p] || p,
      count: providerCounts[p],
      color: PROVIDER_COLOR[p] || '#64748b',
      syncSupported: isCommentSyncSupported(p),
    }))
  }, [providerCounts])

  const filteredItems = useMemo(() => {
    let list = [...items]
    const q = query.trim().toLowerCase()
    if (q) {
      list = list.filter((c) => {
        const hay = [
          c.comment,
          c.author,
          c.analysis?.summary,
          ...(c.analysis?.topics || []),
        ].join(' ').toLowerCase()
        return hay.includes(q)
      })
    }
    if (providerFilter !== 'all') {
      list = list.filter((c) => String(c.provider) === providerFilter)
    }
    switch (filter) {
      case 'needs_reply':
        list = list.filter(needsReply)
        break
      case 'urgent':
        list = list.filter(isUrgent)
        break
      case 'analyzing':
        list = list.filter((c) => isAnalyzing(c, settings.auto_analyze_comments))
        break
      case 'replied':
        list = list.filter((c) => c.reply?.status === 'sent')
        break
      default:
        break
    }
    if (sort === 'urgency') {
      list.sort((a, b) => {
        const ra = URGENCY_RANK[a.analysis?.urgency] ?? 3
        const rb = URGENCY_RANK[b.analysis?.urgency] ?? 3
        if (ra !== rb) return ra - rb
        return new Date(commentTimestamp(b)) - new Date(commentTimestamp(a))
      })
    } else {
      list.sort((a, b) => new Date(commentTimestamp(b)) - new Date(commentTimestamp(a)))
    }
    return list
  }, [items, filter, providerFilter, sort, query, settings.auto_analyze_comments])

  const commentablePublishCount = useMemo(
    () => (publishAccounts || []).filter(
      (r) => r.success && r.provider_post_id && isCommentSyncSupported(r.account?.provider),
    ).length,
    [publishAccounts],
  )

  async function handleSync() {
    setSyncing(true)
    try {
      await api.syncPostComments(postId)
      toast.success('Comment sync queued')
      setTimeout(() => load(true), 2500)
    } catch (err) {
      toast.error(err.message || 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  async function handleAnalyze(commentId) {
    setAnalyzingId(commentId)
    try {
      const out = await api.analyzePostComment(postId, commentId)
      setItems((prev) => prev.map((c) => (c.id === commentId ? { ...c, ...out, id: commentId } : c)))
      setExpanded((e) => ({ ...e, [commentId]: true }))
      toast.success('Comment analyzed')
    } catch (err) {
      toast.error(err.message || 'Analysis failed')
    } finally {
      setAnalyzingId(null)
    }
  }

  async function handleReply(commentId) {
    const text = String(replyDrafts[commentId] || '').trim()
    if (!text) {
      toast.error('Enter a reply')
      return
    }
    setReplyingId(commentId)
    try {
      await api.replyPostComment(postId, commentId, text)
      setItems((prev) => prev.map((c) => (
        c.id === commentId ? { ...c, reply: { status: 'pending', text } } : c
      )))
      toast.success('Reply queued')
      setTimeout(() => load(true), 3000)
    } catch (err) {
      toast.error(err.message || 'Reply failed')
    } finally {
      setReplyingId(null)
    }
  }

  function toggleExpanded(commentId) {
    setExpanded((e) => ({ ...e, [commentId]: !e[commentId] }))
  }

  function useProposedReply(commentId, text) {
    setReplyDrafts((d) => ({ ...d, [commentId]: text }))
    setExpanded((e) => ({ ...e, [commentId]: true }))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Stats */}
      <div className="grid-4" style={{ marginBottom: 0 }}>
        <div className="card stat-card">
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">Comments synced</div>
        </div>
        <div className="card stat-card">
          <div className="stat-value" style={{ color: stats.needsReply > 0 ? '#f59e0b' : 'var(--fg-muted)' }}>
            {stats.needsReply}
          </div>
          <div className="stat-label">Needs reply</div>
        </div>
        <div className="card stat-card">
          <div className="stat-value" style={{ color: stats.urgent > 0 ? '#ef4444' : 'var(--fg-muted)' }}>
            {stats.urgent}
          </div>
          <div className="stat-label">Urgent / medium</div>
        </div>
        <div className="card stat-card">
          <div className="stat-value" style={{ color: '#10b981' }}>{stats.replied}</div>
          <div className="stat-label">Replied</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="card" style={{ padding: '1rem 1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              <MessageSquare size={18} /> Engagement
            </div>
            <p className="text-muted text-sm" style={{ margin: '6px 0 0', maxWidth: 520 }}>
              Sync comments from {commentSyncSupportedLabel()}.
              {commentablePublishCount > 0
                ? ` ${commentablePublishCount} published account(s) support comment sync.`
                : ' Publish to a supported platform first.'}
              {settings.auto_analyze_comments
                ? ' Auto-analyze is on.'
                : (
                  <>
                    {' '}
                    <Link href="/preferences" style={{ fontWeight: 600 }}>Enable auto-analyze</Link>
                  </>
                )}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleSync}
            disabled={syncing || commentablePublishCount === 0}
          >
            {syncing ? 'Syncing…' : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <RefreshCw size={14} /> Sync comments
              </span>
            )}
          </button>
        </div>

        <CommentPlatformSupportNote variant="compact" publishAccounts={publishAccounts} />

        {hasPendingWork && (
          <div
            className="text-sm"
            style={{
              marginTop: 12,
              padding: '8px 12px',
              borderRadius: 8,
              background: 'hsl(var(--primary) / 0.08)',
              color: 'hsl(var(--primary))',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Clock size={14} />
            {stats.analyzing > 0 && `${stats.analyzing} analyzing`}
            {stats.analyzing > 0 && items.some((c) => c.reply?.status === 'pending') && ' · '}
            {items.some((c) => c.reply?.status === 'pending') && 'Reply in progress'}
            {' — '}refreshing automatically
          </div>
        )}

        {/* Filters row */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14, alignItems: 'center' }}>
          <Filter size={14} className="text-muted" />
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`btn btn-sm ${filter === f.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              {f.id === 'all' && stats.total > 0 ? ` (${stats.total})` : ''}
              {f.id === 'needs_reply' && stats.needsReply > 0 ? ` (${stats.needsReply})` : ''}
              {f.id === 'urgent' && stats.urgent > 0 ? ` (${stats.urgent})` : ''}
              {f.id === 'analyzing' && stats.analyzing > 0 ? ` (${stats.analyzing})` : ''}
              {f.id === 'replied' && stats.replied > 0 ? ` (${stats.replied})` : ''}
            </button>
          ))}
        </div>

        {providerOptions.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            <button
              type="button"
              className={`btn btn-sm ${providerFilter === 'all' ? 'btn-secondary' : 'btn-ghost'}`}
              style={providerFilter === 'all' ? { fontWeight: 600 } : {}}
              onClick={() => setProviderFilter('all')}
            >
              All platforms
            </button>
            {providerOptions.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`btn btn-sm ${providerFilter === p.id ? 'btn-secondary' : 'btn-ghost'}`}
                style={{
                  fontWeight: providerFilter === p.id ? 600 : 400,
                  borderLeft: `3px solid ${p.color}`,
                }}
                onClick={() => setProviderFilter(p.id)}
              >
                {p.label} ({p.count})
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12, alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 180 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }} />
            <input
              type="search"
              className="form-input"
              placeholder="Search comments, authors, topics…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ paddingLeft: 32, fontSize: '0.85rem' }}
            />
          </div>
          <select
            className="form-input"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            style={{ width: 'auto', fontSize: '0.85rem' }}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: 88, borderRadius: 12 }} />
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="card" style={{ padding: '2.5rem', textAlign: 'center' }}>
          {items.length === 0 ? (
            <>
              <MessageSquare size={32} style={{ opacity: 0.35, marginBottom: 12 }} />
              <p style={{ margin: '0 0 8px', fontWeight: 600 }}>No comments yet</p>
              <p className="text-muted text-sm" style={{ margin: '0 0 16px', maxWidth: 400, marginInline: 'auto' }}>
                Comments appear after sync from supported platforms. They often arrive minutes after publish.
              </p>
              {commentablePublishCount > 0 && (
                <button type="button" className="btn btn-primary btn-sm" onClick={handleSync} disabled={syncing}>
                  Sync now
                </button>
              )}
            </>
          ) : (
            <p className="text-muted text-sm" style={{ margin: 0 }}>
              No comments match your filters. Try clearing search or switching filters.
            </p>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filteredItems.map((c) => {
            const analysis = c.analysis || {}
            const sentiment = analysis.sentiment
              ? SENTIMENT_STYLE[analysis.sentiment] || SENTIMENT_STYLE.neutral
              : null
            const status = analysis.analysis_status
            const canReply = c.reply_supported !== false && c.provider_comment_id
            const replyStatus = c.reply?.status || 'none'
            const isOpen = expanded[c.id] === true
            const providerColor = PROVIDER_COLOR[c.provider] || '#64748b'
            const showUrgent = analysis.urgency === 'high'

            return (
              <div
                key={c.id}
                className="card"
                style={{
                  padding: 0,
                  overflow: 'hidden',
                  borderLeft: `4px solid ${showUrgent ? '#ef4444' : providerColor}`,
                }}
              >
                <button
                  type="button"
                  onClick={() => toggleExpanded(c.id)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '14px 16px',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'inherit',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                        {c.author ? (
                          <strong style={{ fontSize: '0.9rem' }}>{c.author}</strong>
                        ) : (
                          <span className="text-muted text-sm">Unknown author</span>
                        )}
                        <span
                          className="text-xs"
                          style={{
                            background: `${providerColor}22`,
                            color: providerColor,
                            padding: '2px 8px',
                            borderRadius: 4,
                            fontWeight: 600,
                          }}
                        >
                          {PROVIDER_LABEL[c.provider] || c.provider}
                        </span>
                        {c.platform_created_at && (
                          <span className="text-xs text-muted">
                            {formatWhen(c.platform_created_at, formatDateTime)}
                          </span>
                        )}
                      </div>
                      <p
                        style={{
                          margin: 0,
                          fontSize: '0.9rem',
                          lineHeight: 1.45,
                          whiteSpace: isOpen ? 'pre-wrap' : 'nowrap',
                          overflow: 'hidden',
                          textOverflow: isOpen ? undefined : 'ellipsis',
                        }}
                      >
                        {c.comment}
                      </p>
                      {!isOpen && analysis.summary && (
                        <p className="text-muted text-xs" style={{ margin: '6px 0 0' }}>{analysis.summary}</p>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                      {isOpen ? <ChevronUp size={16} className="text-muted" /> : <ChevronDown size={16} className="text-muted" />}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end' }}>
                        {sentiment && (
                          <span className="badge" style={{ background: `${sentiment.color}22`, color: sentiment.color }}>
                            {sentiment.label}
                          </span>
                        )}
                        {showUrgent && (
                          <span className="badge badge-failed" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                            <AlertTriangle size={10} /> {analysis.urgency}
                          </span>
                        )}
                        {isAnalyzing(c, settings.auto_analyze_comments) && (
                          <span className="badge badge-scheduled">Analyzing…</span>
                        )}
                        {replyStatus === 'sent' && (
                          <span className="badge badge-published" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                            <CheckCircle2 size={10} /> Replied
                          </span>
                        )}
                        {needsReply(c) && (
                          <span className="badge badge-scheduled">Needs reply</span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>

                {isOpen && (
                  <div style={{ padding: '0 16px 16px', borderTop: '1px solid hsl(var(--border) / 0.5)' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '12px 0 8px' }}>
                      {analysis.urgency && analysis.urgency !== 'low' && !showUrgent && (
                        <span className="badge badge-scheduled">Urgency: {analysis.urgency}</span>
                      )}
                      {status === 'failed' && <span className="badge badge-failed">Analysis failed</span>}
                      {replyStatus === 'pending' && <span className="badge badge-scheduled">Reply sending…</span>}
                      {replyStatus === 'failed' && <span className="badge badge-failed">Reply failed</span>}
                      {analysis.topics?.length > 0 && analysis.topics.map((t) => (
                        <span key={t} className="badge badge-draft">{t}</span>
                      ))}
                    </div>

                    {analysis.summary && (
                      <p className="text-sm text-muted" style={{ margin: '0 0 12px' }}>{analysis.summary}</p>
                    )}

                    {analysis.proposed_replies?.length > 0 && (
                      <div style={{ marginBottom: 14 }}>
                        <div className="text-muted text-xs" style={{ marginBottom: 6, fontWeight: 600 }}>
                          AI proposed replies
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {analysis.proposed_replies.map((reply, i) => (
                            <div
                              key={i}
                              className="glass-card"
                              style={{
                                padding: '10px 12px',
                                fontSize: '0.85rem',
                                display: 'flex',
                                justifyContent: 'space-between',
                                gap: 10,
                                alignItems: 'flex-start',
                              }}
                            >
                              <span style={{ flex: 1, lineHeight: 1.45 }}>{reply}</span>
                              {canReply && replyStatus !== 'sent' && (
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  style={{ flexShrink: 0 }}
                                  onClick={() => useProposedReply(c.id, reply)}
                                >
                                  Use
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>
                      {status !== 'pending' && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={analyzingId === c.id}
                          onClick={() => handleAnalyze(c.id)}
                        >
                          {analyzingId === c.id ? 'Analyzing…' : (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <Sparkles size={12} /> {status === 'done' ? 'Re-analyze' : 'Analyze'}
                            </span>
                          )}
                        </button>
                      )}

                      {canReply && replyStatus !== 'sent' && (
                        <div style={{ flex: '1 1 280px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                          <textarea
                            className="form-input"
                            rows={2}
                            placeholder="Write a reply…"
                            value={replyDrafts[c.id] ?? c.reply?.text ?? ''}
                            onChange={(e) => setReplyDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                            style={{ flex: 1, fontSize: '0.85rem' }}
                          />
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={replyingId === c.id || replyStatus === 'pending'}
                            onClick={() => handleReply(c.id)}
                          >
                            {replyingId === c.id || replyStatus === 'pending' ? '…' : (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <Send size={12} /> Reply
                              </span>
                            )}
                          </button>
                        </div>
                      )}
                    </div>

                    {c.reply?.error && replyStatus === 'failed' && (
                      <p className="text-xs" style={{ color: 'hsl(var(--danger))', margin: '10px 0 0' }}>
                        {c.reply.error}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
