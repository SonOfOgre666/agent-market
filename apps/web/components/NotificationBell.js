'use client'
import { useEffect, useRef, useState } from 'react'
import { subscribe } from '../lib/socket.js'

const MAX = 50

function timeAgo(date) {
  const secs = Math.floor((Date.now() - new Date(date)) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

function buildNotification(channel, data) {
  const ts = new Date().toISOString()
  if (channel === 'agentmarket:post_published') {
    const failed = data.errors?.length > 0
    return {
      id: `${channel}-${ts}`,
      type: failed ? 'error' : 'success',
      icon: failed ? '✕' : '✓',
      title: failed ? 'Post publish failed' : 'Post published',
      body: failed
        ? `${data.errors?.length} account(s) failed`
        : `Published to ${data.published?.length ?? '?'} account(s)`,
      post_id: data.post_id,
      ts,
    }
  }
  if (channel === 'agentmarket:post_scheduled') {
    return { id: `${channel}-${ts}`, type: 'info', icon: '⊟', title: 'Post scheduled', body: 'A post has been queued for publishing', post_id: data.post_id, ts }
  }
  if (channel === 'agentmarket:account_added') {
    return { id: `${channel}-${ts}`, type: 'success', icon: '⊙', title: 'Account connected', body: 'A new social account was added', ts }
  }
  if (channel === 'agentmarket:account_unauthorized') {
    return { id: `${channel}-${ts}`, type: 'error', icon: '⚠', title: 'Account disconnected', body: 'An account token expired — reconnect it', ts }
  }
  if (channel === 'agentmarket:budget_alert') {
    const pct = data.percent
    const level = pct >= 100 ? 'error' : pct >= 90 ? 'warning' : 'warning'
    return {
      id: `${channel}-${data.campaign_id}-${pct}-${ts}`,
      type: level,
      icon: pct >= 100 ? '✕' : '⚠',
      title: pct >= 100 ? 'Budget exhausted' : `Budget at ${pct}%`,
      body: `Campaign "${data.campaign_name}" has used ${pct}% of its budget`,
      ts,
    }
  }
  return null
}

const TYPE_COLOR = { success: '#10b981', error: '#ef4444', info: '#6366f1', warning: '#f59e0b' }

export default function NotificationBell() {
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
    const channels = [
      'agentmarket:post_published',
      'agentmarket:post_scheduled',
      'agentmarket:account_added',
      'agentmarket:account_unauthorized',
      'agentmarket:budget_alert',
    ]
    const unsubs = channels.map(ch => subscribe(ch, data => push(buildNotification(ch, data))))
    return () => { unsubs.forEach(fn => typeof fn === 'function' && fn()) }
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
          color: 'var(--fg-muted)', fontSize: '1.1rem', position: 'relative', lineHeight: 1,
          borderRadius: 8,
          background: open ? 'var(--surface-2)' : 'transparent',
        }}
        title="Notifications"
      >
        🔔
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: 0, right: 0,
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
              {notifs.map(n => (
                <div key={n.id} style={{ display: 'flex', gap: '0.75rem', padding: '0.75rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.05)', alignItems: 'flex-start' }}>
                  <span style={{
                    width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                    background: (TYPE_COLOR[n.type] || '#6366f1') + '22',
                    color: TYPE_COLOR[n.type] || '#6366f1',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.75rem', fontWeight: 700,
                  }}>
                    {n.icon}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{n.title}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginTop: '0.1rem' }}>{n.body}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--fg-muted)', marginTop: '0.2rem' }}>{timeAgo(n.ts)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
