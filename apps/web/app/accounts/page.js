'use client'
import { useEffect, useState } from 'react'
import AppLayout from '../../components/AppLayout.js'
import Modal from '../../components/Modal.js'
import { api } from '../../lib/api.js'
import { useToast } from '../../components/Toast.js'
import { useConfirmDialog } from '../../lib/useConfirmDialog.js'
import { socialProviderSlug } from '../../lib/accountKinds.js'
import { SocialConnectIcon } from '../../components/SocialConnectIcon.js'
import { AccountAvatar } from '../../components/AccountAvatar.js'
import { Users, Plus, RefreshCw, Trash2, X } from 'lucide-react'

const SOCIAL_CONNECT = [
  { id: 'facebook_page', label: 'Facebook Page', sub: 'Connect a Facebook Page you manage', color: '#1877f2' },
  { id: 'instagram_login', label: 'Instagram', sub: 'Connect an Instagram account', color: '#c13584' },
  { id: 'tiktok', label: 'TikTok', sub: 'Connect a TikTok account', color: '#010101' },
  { id: 'linkedin', label: 'LinkedIn', sub: 'Connect a LinkedIn personal or company page', color: '#0a66c2' },
  { id: 'twitter', label: 'Twitter / X', sub: 'Connect a Twitter/X account', color: '#1d9bf0' },
]

const ADS_CONNECT = [
  { id: 'google_ads', label: 'Google Ads', sub: 'Connect a Google Ads customer account for campaigns and reporting', color: '#4285f4' },
  { id: 'meta_ads', label: 'Meta Ads', sub: 'Connect a Meta (Facebook) ad account for campaigns and reporting', color: '#1877f2' },
]

const ADS_LABEL = { google_ads: 'Google Ads', meta_ads: 'Meta Ads' }
const IMPORT_PROVIDERS = ['twitter', 'facebook', 'instagram', 'instagram_login', 'tiktok', 'linkedin']

const sectionHeader = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '1rem',
  marginBottom: '0.75rem',
  flexWrap: 'wrap',
}

const sectionTitle = {
  fontSize: '1.05rem',
  fontWeight: 600,
  margin: 0,
}

const sectionDesc = {
  fontSize: '0.8rem',
  color: 'var(--fg-muted)',
  margin: '0.25rem 0 0',
  maxWidth: 520,
}

function ConnectModal({ open, onClose, title, options, onConnect }) {
  return (
    <Modal open={open} onClose={onClose}>
      <div className="modal" style={{ maxWidth: 480, maxHeight: 'min(85vh, 640px)', overflowY: 'auto', width: '100%' }}>
        <div className="flex items-center justify-between" style={{ marginBottom: '1.25rem' }}>
          <h2 className="modal-title" style={{ margin: 0 }}>{title}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            <X size={14} strokeWidth={2} />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
          {options.map(opt => (
            <button
              key={opt.id}
              type="button"
              className="card card-sm flex items-center gap-3"
              style={{
                cursor: 'pointer',
                textAlign: 'left',
                borderLeft: `4px solid ${opt.color}`,
                background: 'hsl(var(--surface))',
                width: '100%',
                minWidth: 0,
                alignItems: 'flex-start',
              }}
              onClick={() => onConnect(opt)}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: opt.color + '22',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: opt.color,
                  flexShrink: 0,
                  marginTop: 2,
                }}
              >
                <SocialConnectIcon provider={opt.id} size={18} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{opt.label}</div>
                <div className="text-xs text-muted" style={{ marginTop: '0.15rem', lineHeight: 1.45 }}>{opt.sub}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}

export default function AccountsPage() {
  const [socialAccounts, setSocialAccounts] = useState([])
  const [adsAccounts, setAdsAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showSocialModal, setShowSocialModal] = useState(false)
  const [showAdsModal, setShowAdsModal] = useState(false)
  const [queueingImports, setQueueingImports] = useState({})
  const [syncingGads, setSyncingGads] = useState(false)
  const [googlePickerAccountId, setGooglePickerAccountId] = useState(null)
  const [googleCustomers, setGoogleCustomers] = useState([])
  const [googlePickerLoading, setGooglePickerLoading] = useState(false)
  const [googlePickerSaving, setGooglePickerSaving] = useState(null)
  const toast = useToast()
  const { confirm, ConfirmDialogHost } = useConfirmDialog()

  const load = async () => {
    setLoading(true)
    try {
      const [social, ads] = await Promise.all([
        api.accounts({ kind: 'social' }),
        api.accounts({ kind: 'ads' }),
      ])
      setSocialAccounts(social || [])
      setAdsAccounts(ads || [])
    } catch (e) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const connected = params.get('connected')
    if (connected) {
      toast.success(connected === 'ads' ? 'Ads account connected successfully' : 'Account connected successfully')
      window.history.replaceState({}, '', '/accounts')
      load()
    }
    if (params.get('error')) {
      toast.error(decodeURIComponent(params.get('error')))
      window.history.replaceState({}, '', '/accounts')
    }
  }, [])

  const openGoogleCustomerPicker = async (mongoAccountId) => {
    setGooglePickerAccountId(mongoAccountId)
    setGooglePickerLoading(true)
    setGoogleCustomers([])
    try {
      const res = await api.googleAdsCustomers(mongoAccountId)
      setGoogleCustomers(res.customers || [])
      if (res.customer_id && !(res.customers || []).length) {
        toast.success('Customer ID already set')
        setGooglePickerAccountId(null)
      }
    } catch (e) {
      toast.error(e.message)
      setGooglePickerAccountId(null)
    } finally {
      setGooglePickerLoading(false)
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const pickGoogle = params.get('pick_google')
    if (pickGoogle) {
      openGoogleCustomerPicker(pickGoogle)
      window.history.replaceState({}, '', '/accounts')
    }
  }, [])

  const saveGoogleCustomer = async (customer) => {
    if (!googlePickerAccountId) return
    const customerId =
      typeof customer === 'string' || typeof customer === 'number'
        ? String(customer)
        : String(customer.customer_id || customer.id || '')
    setGooglePickerSaving(customerId)
    try {
      const payload =
        typeof customer === 'object' && customer !== null
          ? {
              customer_id: customerId,
              login_customer_id: customer.login_customer_id || null,
              name: customer.name,
              account_type_label: customer.account_type_label,
            }
          : { customer_id: customerId }
      await api.setGoogleAdsCustomer(googlePickerAccountId, payload)
      toast.success('Google Ads customer linked')
      setGooglePickerAccountId(null)
      load()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setGooglePickerSaving(null)
    }
  }

  const connectSocial = async option => {
    try {
      const { auth_url } = await api.addAccount(option.id, {}, { kind: 'social' })
      setShowSocialModal(false)
      window.location.href = auth_url
    } catch (err) {
      toast.error(err.message)
    }
  }

  const connectAds = async option => {
    try {
      const { auth_url } = await api.addAccount(option.id, {}, { kind: 'ads' })
      setShowAdsModal(false)
      window.location.href = auth_url
    } catch (err) {
      toast.error(err.message)
    }
  }

  const refresh = async id => {
    try {
      await api.refreshAccount(id)
      toast.success('Account refreshed')
      load()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const remove = async (id, kind) => {
    const label = kind === 'ads' ? 'ads account' : 'account'
    const ok = await confirm({
      title: 'Remove account?',
      message: `Remove this ${label}? You can reconnect it later from the connect flow.`,
      confirmLabel: 'Remove',
    })
    if (!ok) return
    try {
      await api.deleteAccount(id)
      toast.success('Account removed')
      load()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const queueImports = async id => {
    setQueueingImports(m => ({ ...m, [id]: true }))
    try {
      const res = await api.queueAccountImports(id)
      toast.success(res.mode === 'celery_orchestrator' ? 'Import jobs queued (orchestrator)' : 'Import jobs queued')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setQueueingImports(m => ({ ...m, [id]: false }))
    }
  }

  const syncGoogleAds = async () => {
    setSyncingGads(true)
    try {
      const res = await api.syncGoogleAdsCampaigns()
      if (res?.queued) toast.success(res.message || 'Sync queued')
      else toast.success(`Synced ${res.synced} campaign(s) from Google Ads`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSyncingGads(false)
    }
  }

  const skeleton = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {[1, 2].map(i => (
        <div key={i} className="skeleton" style={{ height: 72, borderRadius: 12 }} />
      ))}
    </div>
  )

  return (
    <AppLayout>
      <div className="page-header-enhanced">
        <div className="page-header-content">
          <div className="page-header-title">
            <div className="page-header-icon">
              <Users size={18} strokeWidth={2.5} />
            </div>
            <h1 className="page-title">Accounts</h1>
          </div>
          <p className="page-header-desc">Social pages for posts and ads accounts for paid campaigns</p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        {/* Social Accounts */}
        <section>
          <div style={sectionHeader}>
            <div>
              <h2 style={sectionTitle}>Social Accounts</h2>
              <p style={sectionDesc}>Connect pages and profiles for scheduling posts (not ads accounts)</p>
            </div>
            <button className="btn btn-primary" onClick={() => setShowSocialModal(true)}>
              <Plus size={14} strokeWidth={2.5} /> Add Account
            </button>
          </div>

          {loading ? (
            skeleton
          ) : !socialAccounts.length ? (
            <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--fg-muted)' }}>
              <p style={{ margin: 0 }}>No social accounts connected yet.</p>
              <button className="btn btn-primary btn-sm" style={{ marginTop: '1rem' }} onClick={() => setShowSocialModal(true)}>
                <Plus size={14} strokeWidth={2.5} /> Add Account
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {socialAccounts.map(acc => (
                <div key={acc.id} className="card card-sm flex items-center gap-3">
                  <AccountAvatar account={acc} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{acc.name}</div>
                    <div className="text-muted text-sm">@{acc.username || '—'} · {socialProviderSlug(acc.provider)}</div>
                  </div>
                  <span className={`badge ${acc.authorized ? 'badge-published' : 'badge-failed'}`}>
                    {acc.authorized ? 'Active' : 'Unauthorized'}
                  </span>
                  <div className="flex gap-2">
                    {IMPORT_PROVIDERS.includes(acc.provider) && acc.authorized && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => queueImports(acc.id)}
                        disabled={queueingImports[acc.id]}
                        title="Queue follower / post / insight imports"
                      >
                        {queueingImports[acc.id] ? <span className="spinner" /> : <>Sync data</>}
                      </button>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => refresh(acc.id)}>
                      <RefreshCw size={12} strokeWidth={2} /> Refresh
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => remove(acc.id, 'social')}>
                      <Trash2 size={12} strokeWidth={2} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Ads Accounts */}
        <section>
          <div style={sectionHeader}>
            <div>
              <h2 style={sectionTitle}>Ads Accounts</h2>
              <p style={sectionDesc}>Google Ads and Meta Ads only — for campaigns and paid reporting</p>
            </div>
            <button className="btn btn-primary" onClick={() => setShowAdsModal(true)}>
              <Plus size={14} strokeWidth={2.5} /> Connect Ads Account
            </button>
          </div>

          {loading ? (
            skeleton
          ) : !adsAccounts.length ? (
            <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--fg-muted)' }}>
              <p style={{ margin: 0 }}>No ads accounts connected yet.</p>
              <button className="btn btn-primary btn-sm" style={{ marginTop: '1rem' }} onClick={() => setShowAdsModal(true)}>
                <Plus size={14} strokeWidth={2.5} /> Connect Ads Account
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {adsAccounts.map(acc => (
                <div key={acc.id} className="card card-sm flex items-center gap-3">
                  <AccountAvatar account={acc} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{acc.name}</div>
                    <div className="text-muted text-sm">{ADS_LABEL[acc.provider] || acc.provider}</div>
                    {acc.provider === 'google_ads' && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--fg-muted)', marginTop: '0.15rem' }}>
                        {acc.data?.customer_id ? (
                          <>
                            {acc.data.account_type_label ? (
                              <span>{acc.data.account_type_label} · </span>
                            ) : null}
                            Customer ID:{' '}
                            <code style={{ background: 'var(--surface-alt)', padding: '0.1rem 0.3rem', borderRadius: 4 }}>
                              {acc.data.customer_id}
                            </code>
                            {acc.data.login_customer_id ? (
                              <span style={{ display: 'block', marginTop: '0.1rem' }}>
                                Login (MCC):{' '}
                                <code style={{ background: 'var(--surface-alt)', padding: '0.1rem 0.3rem', borderRadius: 4 }}>
                                  {acc.data.login_customer_id}
                                </code>
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span style={{ color: 'var(--warning, #b45309)' }}>
                            No customer selected — reporting will fail until you pick one.
                          </span>
                        )}
                      </div>
                    )}
                    {acc.provider === 'meta_ads' && acc.data?.ad_account_id && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--fg-muted)', marginTop: '0.15rem' }}>
                        Ad account:{' '}
                        <code style={{ background: 'var(--surface-alt)', padding: '0.1rem 0.3rem', borderRadius: 4 }}>
                          {acc.data.ad_account_id}
                        </code>
                      </div>
                    )}
                  </div>
                  <span className={`badge ${acc.authorized ? 'badge-published' : 'badge-failed'}`}>
                    {acc.authorized ? 'Active' : 'Unauthorized'}
                  </span>
                  <div className="flex gap-2">
                    {acc.provider === 'google_ads' && acc.authorized && !acc.data?.customer_id && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => openGoogleCustomerPicker(acc.id)}
                        title="Select Google Ads customer account"
                      >
                        Select customer
                      </button>
                    )}
                    {acc.provider === 'google_ads' && acc.authorized && acc.data?.customer_id && (
                      <>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => openGoogleCustomerPicker(acc.id)}
                          title="Change which Google Ads customer ID is used for campaigns"
                        >
                          Change customer
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={syncGoogleAds}
                          disabled={syncingGads}
                          title="Sync campaigns from Google Ads"
                        >
                          {syncingGads ? <span className="spinner" /> : <><RefreshCw size={12} strokeWidth={2} /> Sync</>}
                        </button>
                      </>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => refresh(acc.id)}>
                      <RefreshCw size={12} strokeWidth={2} /> Refresh
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => remove(acc.id, 'ads')}>
                      <Trash2 size={12} strokeWidth={2} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <ConnectModal
        open={showSocialModal}
        onClose={() => setShowSocialModal(false)}
        title="Add Social Account"
        options={SOCIAL_CONNECT}
        onConnect={connectSocial}
      />
      <ConnectModal
        open={showAdsModal}
        onClose={() => setShowAdsModal(false)}
        title="Connect Ads Account"
        options={ADS_CONNECT}
        onConnect={connectAds}
      />
      <Modal open={Boolean(googlePickerAccountId)} onClose={() => setGooglePickerAccountId(null)}>
        <div className="modal" style={{ maxWidth: 480, width: '100%' }}>
          <h2 className="modal-title">Select Google Ads customer</h2>
          <p className="text-muted text-sm" style={{ marginBottom: '1rem' }}>
            Same step as after OAuth — choose which Google Ads customer ID to use for reporting and campaigns.
          </p>
          {googlePickerLoading ? (
            <div className="skeleton" style={{ height: 120 }} />
          ) : !googleCustomers.length ? (
            <p className="text-muted text-sm">No accessible customers found. Check developer token and OAuth access.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {googleCustomers.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="card card-sm flex items-center gap-3"
                  style={{ cursor: 'pointer', textAlign: 'left', width: '100%' }}
                  onClick={() => saveGoogleCustomer(c)}
                  disabled={googlePickerSaving === (c.customer_id || c.id)}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{c.name}</div>
                    <div className="text-xs text-muted">
                      {c.account_type_label || (c.manager ? 'Manager' : 'Ads Account')}
                      {' · '}
                      {c.customer_id_display || c.customer_id || c.id}
                      {c.currency ? ` · ${c.currency}` : ''}
                      {c.test_account ? ' · Test' : ''}
                      {c.manager_name ? ` · MCC: ${c.manager_name}` : ''}
                    </div>
                  </div>
                  {googlePickerSaving === (c.customer_id || c.id) ? (
                    <span className="spinner" />
                  ) : (
                    <span className="btn btn-primary btn-sm">Use</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </Modal>
      <ConfirmDialogHost />
    </AppLayout>
  )
}
