'use client'
import { useEffect, useState } from 'react'
import AppLayout from '../../components/AppLayout.js'
import { api } from '../../lib/api.js'
import { useToast } from '../../components/Toast.js'

// Each option: label shown in modal, provider sent to API, display color
const CONNECT_OPTIONS = [
  { id: 'facebook_page',   label: 'Facebook Page',             sub: 'Connect a Facebook Page you manage',              color: '#1877f2' },
  { id: 'instagram',       label: 'Instagram (via Facebook)',  sub: 'Connect an Instagram Business account via Meta',  color: '#e1306c' },
  { id: 'instagram_login', label: 'Instagram (Direct Login)',  sub: 'Connect Instagram directly without Facebook',     color: '#c13584' },
  { id: 'tiktok',          label: 'TikTok',                   sub: 'Connect a TikTok account',                        color: '#010101' },
  { id: 'linkedin',        label: 'LinkedIn',                  sub: 'Connect a LinkedIn personal or company page',     color: '#0a66c2' },
  { id: 'twitter',         label: 'Twitter / X',              sub: 'Connect a Twitter/X account',                     color: '#1d9bf0' },
  { id: 'google_ads',      label: 'Google Ads',               sub: 'Connect a Google Ads account to sync campaigns',  color: '#4285f4' },
]

const PROVIDER_ICON = { twitter: '𝕏', facebook: 'f', instagram: '⊙', instagram_login: '⊙', tiktok: '♪', linkedin: 'in', google_ads: 'G' }

export default function AccountsPage() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [syncingGads, setSyncingGads] = useState(false)
  const toast = useToast()

  const load = () => api.accounts().then(setAccounts).catch(e => toast.error(e.message)).finally(() => setLoading(false))

  useEffect(() => { load() }, [])

  // Check URL params for success/error on return from OAuth
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('connected')) {
      toast.success('Account connected successfully')
      window.history.replaceState({}, '', '/accounts')
      load()
    }
    if (params.get('error')) {
      toast.error(decodeURIComponent(params.get('error')))
      window.history.replaceState({}, '', '/accounts')
    }
  }, [])

  const connect = async (option) => {
    try {
      const { auth_url } = await api.addAccount(option.id, {})
      setShowModal(false)
      window.location.href = auth_url
    } catch (err) {
      toast.error(err.message)
    }
  }

  const refresh = async (id) => {
    try {
      await api.refreshAccount(id)
      toast.success('Account refreshed')
      load()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const remove = async (id) => {
    if (!confirm('Remove this account?')) return
    try {
      await api.deleteAccount(id)
      toast.success('Account removed')
      load()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const syncGoogleAds = async () => {
    setSyncingGads(true)
    try {
      const res = await api.syncGoogleAdsCampaigns()
      toast.success(`Synced ${res.synced} campaign(s) from Google Ads`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSyncingGads(false)
    }
  }

  return (
    <AppLayout>
      <div className="page-header">
        <h1 className="page-title">Accounts</h1>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Add Account</button>
      </div>

      {/* Connected accounts list */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {[1,2].map(i => <div key={i} className="skeleton" style={{ height: 72, borderRadius: 12 }} />)}
        </div>
      ) : !accounts.length ? (
        <div className="empty-state">
          <div className="empty-icon">⊙</div>
          <div className="empty-title">No accounts connected</div>
          <div className="empty-desc">Connect a social media account to start scheduling posts.</div>
          <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={() => setShowModal(true)}>Add Account</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {accounts.map(acc => (
            <div key={acc.id} className="card card-sm flex items-center gap-3">
              {acc.media?.avatar
                ? <img src={acc.media.avatar} className="avatar" alt="" />
                : <div className={`avatar provider-${acc.provider}`}>{PROVIDER_ICON[acc.provider]}</div>}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{acc.name}</div>
                <div className="text-muted text-sm">@{acc.username} · {acc.provider}</div>
                {acc.provider === 'google_ads' && acc.data?.customer_id && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--fg-muted)', marginTop: '0.15rem' }}>
                    Customer ID: <code style={{ background: 'var(--surface-2)', padding: '0.1rem 0.3rem', borderRadius: 4 }}>{acc.data.customer_id}</code>
                    {acc.data?.email && <span style={{ marginLeft: '0.5rem' }}>· {acc.data.email}</span>}
                  </div>
                )}
                {acc.provider === 'google_ads' && !acc.data?.customer_id && (
                  <div style={{ fontSize: '0.72rem', color: '#f59e0b', marginTop: '0.15rem' }}>No customer ID found — reconnect to re-fetch</div>
                )}
              </div>
              <span className={`badge ${acc.authorized ? 'badge-published' : 'badge-failed'}`}>
                {acc.authorized ? 'Active' : 'Unauthorized'}
              </span>
              <div className="flex gap-2">
                {acc.provider === 'google_ads' && acc.authorized && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={syncGoogleAds}
                    disabled={syncingGads}
                    title="Pull latest campaigns & metrics from Google Ads"
                  >
                    {syncingGads ? <span className="spinner" /> : '↻ Sync'}
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => refresh(acc.id)}>Refresh</button>
                <button className="btn btn-danger btn-sm" onClick={() => remove(acc.id)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Account modal */}
      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal" style={{ maxWidth: 480 }}>
            <div className="flex items-center justify-between" style={{ marginBottom: '1.25rem' }}>
              <h2 className="modal-title" style={{ margin: 0 }}>Add Account</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <p className="text-muted text-sm" style={{ marginBottom: '1rem' }}>Choose a platform to connect:</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
              {CONNECT_OPTIONS.map((opt, i) => (
                <button
                  key={i}
                  className="card card-sm flex items-center gap-3"
                  style={{ cursor: 'pointer', textAlign: 'left', borderLeft: `4px solid ${opt.color}`, background: 'var(--surface)', width: '100%' }}
                  onClick={() => connect(opt)}
                >
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: opt.color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', color: opt.color, fontWeight: 700, fontSize: 16, flexShrink: 0 }}>
                    {opt.isInstagram ? '⊙' : opt.label[0]}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{opt.label}</div>
                    <div className="text-xs text-muted">{opt.sub}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
