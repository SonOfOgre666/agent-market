'use client'
import { useEffect, useRef, useState } from 'react'
import { subscribe } from '../lib/socket.js'
import { useWorkspaceSettings } from './WorkspaceSettingsProvider.js'
import { Bell, Check, X, AlertTriangle } from 'lucide-react'

const MAX = 50

/** Payloads from Redis ``EVENTS_CHANNEL`` → realtime SC channel ``events`` (``{ event, ... }``). */
function notificationFromEnvelope(msg) {
  const ts = new Date().toISOString()
  const ev = msg?.event
  if (!ev || typeof ev !== 'string') return null

  if (ev === 'post.published') {
    const errors = msg.errors || []
    const published = msg.published || []
    const hasErrors = errors.length > 0
    const pid = msg.post_id || msg.postId
    return {
      id: `${ev}-${pid}-${ts}`,
      type: hasErrors ? 'warning' : 'success',
      iconType: hasErrors ? 'warning' : 'success',
      title: hasErrors ? 'Post published with errors' : 'Post published',
      body: hasErrors
        ? `${errors.length} account(s) failed, ${published.length} succeeded`
        : `Published to ${published.length || '?'} account(s)`,
      post_id: pid,
      ts,
    }
  }
  if (ev === 'post.failed') {
    const pid = msg.post_id || msg.postId
    return {
      id: `${ev}-${pid}-${ts}`,
      type: 'error',
      iconType: 'error',
      title: 'Post failed',
      body: typeof msg.error === 'string' ? msg.error : 'Publish error',
      post_id: pid,
      ts,
    }
  }
  if (ev === 'post.scheduled') {
    const pid = msg.post_id || msg.postId
    return {
      id: `${ev}-${pid}-${ts}`,
      type: 'info',
      iconType: 'info',
      title: 'Post scheduled',
      body: 'A post has been queued for publishing',
      post_id: pid,
      ts,
    }
  }
  if (ev === 'post.drafted') {
    const pid = msg.postId || msg.post_id
    return {
      id: `${ev}-${pid}-${ts}`,
      type: 'info',
      iconType: 'info',
      title: 'Draft saved',
      body: 'A new draft was created',
      post_id: pid,
      ts,
    }
  }
  if (ev === 'integration.connected') {
    const name = msg.provider || 'Provider'
    return {
      id: `${ev}-${msg.account_id || ''}-${ts}`,
      type: 'success',
      iconType: 'success',
      title: 'Account connected',
      body: `${name} connected successfully`,
      ts,
    }
  }
  if (ev === 'account_unauthorized') {
    return {
      id: `${ev}-${msg.account_id || ''}-${ts}`,
      type: 'error',
      iconType: 'warning',
      title: 'Account disconnected',
      body: 'An account token expired — reconnect it',
      ts,
    }
  }
  if (ev === 'budget_alert') {
    const pct = msg.percent
    const level = pct >= 100 ? 'error' : 'warning'
    return {
      id: `${ev}-${msg.campaign_id}-${pct}-${ts}`,
      type: level,
      iconType: level === 'error' ? 'error' : 'warning',
      title: pct >= 100 ? 'Budget exhausted' : `Budget at ${pct}%`,
      body: `Campaign "${msg.campaign_name || 'Campaign'}" has used ${pct}% of its budget`,
      ts,
    }
  }
  return null
}

const ICON_MAP = {
  success: Check,
  error: X,
  info: Bell,
  warning: AlertTriangle,
}

const TYPE_COLOR = { success: '#10b981', error: '#ef4444', info: '#6366f1', warning: '#f59e0b' }

export default function NotificationBell() {
  const { formatDateTime } = useWorkspaceSettings()
  const [notifs, setNotifs] = useState([])
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const panelRef = useRef(null)

  const push = (n) => {
    if (!n) return
    setNotifs(prev => [n, ...prev].slice(0, MAX))
    setUnread(u => u + 1)
  }

  useEffect(() => {
    return subscribe('events', (msg) => push(notificationFromEnvelope(msg)))
  }, [])

  // Close panel on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleOpen = () => {
    setOpen(o => !o)
    setUnread(0)
  }

  const clearAll = () => setNotifs([])

  return (
    <div style={{ position: 'relative' }} ref={panelRef}>
      <button
        onClick={handleOpen}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: '0.35rem',
          color: 'var(--fg-muted)', position: 'relative', lineHeight: 1,
          borderRadius: 8,
          background: open ? 'var(--surface-alt)' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        title="Notifications"
      >
        <Bell size={20} strokeWidth={2} />
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -2, right: -2,
            width: 16, height: 16, borderRadius: '50%',
            background: '#ef4444', color: '#fff',
            fontSize: '0.6rem', fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            lineHeight: 1,
          }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 8px)',
          width: 320, maxHeight: 420, overflowY: 'auto',
          background: 'var(--surface-1)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          zIndex: 200,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.875rem 1rem 0.625rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Notifications</span>
            {notifs.length > 0 && (
              <button onClick={clearAll} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-muted)', fontSize: '0.75rem' }}>
                Clear all
              </button>
            )}
          </div>

          {notifs.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--fg-muted)', fontSize: '0.875rem' }}>
              No notifications yet
            </div>
          ) : (
            <div>
              {notifs.map(n => {
                const IconComponent = ICON_MAP[n.iconType] || Bell
                return (
                  <div key={n.id} style={{ display: 'flex', gap: '0.75rem', padding: '0.75rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.05)', alignItems: 'flex-start' }}>
                    <span style={{
                      width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                      background: (TYPE_COLOR[n.type] || '#6366f1') + '22',
                      color: TYPE_COLOR[n.type] || '#6366f1',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <IconComponent size={14} strokeWidth={2.5} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{n.title}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginTop: '0.1rem' }}>{n.body}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--fg-muted)', marginTop: '0.2rem' }}>{formatDateTime(n.ts)}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
