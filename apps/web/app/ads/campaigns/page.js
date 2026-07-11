'use client'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import AppLayout from '../../../components/AppLayout.js'
import Modal from '../../../components/Modal.js'
import AdsWorkflowStepper from '../../../components/ads/AdsWorkflowStepper.js'
import GoogleAdsCampaignWizard from '../../../components/ads/GoogleAdsCampaignWizard.js'
import MetaBudgetScheduleModal from '../../../components/ads/MetaBudgetScheduleModal.js'
import { api } from '../../../lib/api.js'
import { useToast } from '../../../components/Toast.js'
import { useConfirmDialog } from '../../../lib/useConfirmDialog.js'
import { useWorkspaceSettings } from '../../../components/WorkspaceSettingsProvider.js'

const PLATFORMS = ['google_ads', 'meta_ads']
const PLATFORM_LABEL = {
  google_ads: 'Google Ads',
  meta_ads: 'Meta Ads',
  meta: 'Meta Ads',
  facebook: 'Meta Ads',
}
const PLATFORM_COLOR = {
  google_ads: '#4285f4',
  meta_ads: '#1877f2',
  meta: '#1877f2',
  facebook: '#1877f2',
}
const STATUS_COLOR = { draft: '#64748b', active: '#10b981', paused: '#f59e0b', ended: '#ef4444' }
const STATUSES = ['draft', 'active', 'paused', 'ended']
const TYPES = ['search', 'display', 'video', 'social']
const CURRENCY = ['USD', 'EUR', 'GBP', 'MAD', 'AED']

const EMPTY_FORM = { name: '', platform: 'google_ads', type: 'search', budget_amount: '', budget_currency: 'USD', budget_type: 'total', start_date: '', end_date: '', keywords: '' }

const META_PLATFORMS = new Set(['meta_ads', 'meta', 'facebook'])
const GOOGLE_PLATFORMS = new Set(['google_ads', 'google'])

function normalizePlatformFilter(raw) {
  const p = (raw || '').trim().toLowerCase()
  if (!p) return ''
  if (p === 'meta' || p === 'facebook') return 'meta_ads'
  if (p === 'google') return 'google_ads'
  return p
}

/** Same rules as /ads — API platform filter can miss legacy values; filter in UI too. */
function filterCampaignsByPlatform(campaigns, platformFilter) {
  if (!platformFilter) return campaigns
  if (platformFilter === 'meta_ads') {
    return campaigns.filter((c) => META_PLATFORMS.has(c.platform))
  }
  if (platformFilter === 'google_ads') {
    return campaigns.filter((c) => GOOGLE_PLATFORMS.has(c.platform))
  }
  return campaigns.filter((c) => c.platform === platformFilter)
}

function CampaignsPageContent() {
  const searchParams = useSearchParams()
  const platformFilter = useMemo(
    () => normalizePlatformFilter(searchParams.get('platform')),
    [searchParams],
  )
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [wizardPlatform, setWizardPlatform] = useState(null)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [publishingId, setPublishingId] = useState(null)
  const [filterStatus, setFilterStatus] = useState('')
  const [budgetScheduleCampaign, setBudgetScheduleCampaign] = useState(null)
  const toast = useToast()
  const { confirm, ConfirmDialogHost } = useConfirmDialog()
  const { formatDateTime } = useWorkspaceSettings()

  const canScheduleMetaBudget = (c) =>
    META_PLATFORMS.has(c.platform) && Boolean(c.platform_campaign_id) && Boolean(c.account_id)

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.campaigns({
        status: filterStatus || undefined,
        per_page: 100,
      })
      const all = res.items || []
      const filtered = filterCampaignsByPlatform(all, platformFilter)
      setItems(filtered)
      setTotal(filtered.length)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [filterStatus, platformFilter])

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setWizardPlatform(null); setShowForm(true) }
  const openEdit = (c) => {
    setEditing(c)
    setForm({
      name: c.name,
      platform: c.platform,
      type: c.type,
      budget_amount: c.budget?.amount || '',
      budget_currency: c.budget?.currency || 'USD',
      budget_type: c.budget?.type || 'total',
      start_date: c.start_date ? c.start_date.slice(0, 10) : '',
      end_date: c.end_date ? c.end_date.slice(0, 10) : '',
      keywords: (c.keywords || []).join(', '),
      status: c.status,
    })
    setShowForm(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = {
        name: form.name,
        platform: form.platform,
        type: form.type,
        budget: { amount: parseFloat(form.budget_amount) || 0, currency: form.budget_currency, type: form.budget_type },
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        keywords: form.keywords ? form.keywords.split(',').map(k => k.trim()).filter(Boolean) : [],
        ...(form.status ? { status: form.status } : {}),
      }
      if (editing) {
        await api.updateCampaign(editing.id, payload)
        toast.success('Campaign updated')
      } else {
        await api.createCampaign(payload)
        toast.success('Campaign created')
      }
      setShowForm(false)
      load()
    } catch (e) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (c) => {
    const ok = await confirm({
      title: 'Delete campaign?',
      message: `Delete “${c.name}”? This removes the campaign from your workspace.`,
      confirmLabel: 'Delete',
    })
    if (!ok) return
    try {
      await api.deleteCampaign(c.id)
      toast.success('Campaign deleted')
      load()
    } catch (e) { toast.error(e.message) }
  }

  const pollPublishOutcome = async (campaignId) => {
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      const fresh = await api.campaign(campaignId)
      const err = fresh.publish_errors?.[fresh.publish_errors.length - 1]
      if (fresh.platform_campaign_id) {
        const parts = ['Published to platform']
        if (fresh.platform_ad_set_id) parts.push('ad set')
        if (fresh.platform_ad_id) parts.push('ad')
        else if (META_PLATFORMS.has(fresh.platform)) {
          parts.push('(no ad — add Facebook Page + destination URL in the campaign)')
        }
        return { ok: true, message: parts.join(' · ') }
      }
      if (err) return { ok: false, message: err }
    }
    return { ok: null, message: 'Publish is still running — refresh in a moment' }
  }

  const handlePublish = async (c) => {
    if (!c.account_id) {
      toast.error('Link an ad account to this campaign before publishing')
      return
    }
    if (c.platform_campaign_id) {
      toast.error('Campaign is already published to the platform')
      return
    }
    const ok = await confirm({
      title: 'Publish campaign?',
      message: `Publish “${c.name}” to ${PLATFORM_LABEL[c.platform] || c.platform}? This creates live objects on the ad platform.`,
      confirmLabel: 'Publish',
      variant: 'primary',
    })
    if (!ok) return
    setPublishingId(c.id)
    try {
      await api.publishCampaign(c.id)
      toast.success('Publish queued — creating campaign, ad set, and ad on Meta…')
      const outcome = await pollPublishOutcome(c.id)
      if (outcome.ok === true) toast.success(outcome.message)
      else if (outcome.ok === false) toast.error(outcome.message)
      else toast.success(outcome.message)
      load()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setPublishingId(null)
    }
  }

  const syncGoogleAds = async () => {
    try {
      const res = await api.syncGoogleAdsCampaigns()
      if (res?.queued) {
        toast.success(res.message || 'Sync queued — list will update shortly')
        setTimeout(() => load(), 4000)
      } else {
        toast.success(`Synced ${res.synced} campaign(s) from Google Ads`)
        load()
      }
    } catch (e) { toast.error(e.message) }
  }

  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <h1 className="page-title">Campaigns</h1>
          <p style={{ color: 'var(--fg-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            {total} campaign{total !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <select className="form-input" style={{ width: 140 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="btn btn-secondary" onClick={syncGoogleAds} title="Pull latest campaigns & metrics from Google Ads API">↻ Sync Google Ads</button>
          <button className="btn btn-primary" onClick={openCreate}>+ New Campaign</button>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 80 }} />)}
        </div>
      ) : items.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--fg-muted)' }}>
          <p style={{ margin: 0 }}>
            No campaigns found{platformFilter ? ` for platform “${platformFilter}”` : ''} in this workspace.
          </p>
          {platformFilter && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ marginTop: '0.75rem' }}
              onClick={() => { window.location.href = '/ads/campaigns' }}
            >
              Show all platforms
            </button>
          )}
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Platform</th>
                <th>Type</th>
                <th>Budget</th>
                <th>Spend</th>
                <th>CTR</th>
                <th>Status</th>
                <th>Dates</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map(c => {
                const ctr = c.metrics?.impressions > 0 ? ((c.metrics.clicks / c.metrics.impressions) * 100).toFixed(1) : '—'
                return (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 500 }}>{c.name}</td>
                    <td>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: PLATFORM_COLOR[c.platform] || '#64748b', flexShrink: 0 }} />
                        {PLATFORM_LABEL[c.platform] || c.platform}
                      </span>
                    </td>
                    <td style={{ textTransform: 'capitalize' }}>{c.type}</td>
                    <td>${(c.budget?.amount || 0).toLocaleString()} <span style={{ fontSize: '0.7rem', color: 'var(--fg-muted)' }}>{c.budget?.currency}</span></td>
                    <td>${(c.metrics?.spend || 0).toLocaleString()}</td>
                    <td>{ctr}{ctr !== '—' ? '%' : ''}</td>
                    <td>
                      <span style={{ color: STATUS_COLOR[c.status], fontWeight: 500, fontSize: '0.8rem' }}>{c.status}</span>
                      {c.publish_errors?.length > 0 && (
                        <div
                          title={c.publish_errors[c.publish_errors.length - 1]}
                          style={{
                            fontSize: '0.65rem',
                            color: 'var(--danger)',
                            marginTop: 2,
                            maxWidth: 140,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {c.publish_errors[c.publish_errors.length - 1] || 'Publish failed'}
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--fg-muted)' }}>
                      {c.start_date ? formatDateTime(c.start_date, { style: 'date-only' }) : '—'}
                      {c.end_date ? ` → ${formatDateTime(c.end_date, { style: 'date-only' })}` : ''}
                    </td>
                    <td>
                      <div className="flex gap-1">
                        {!c.platform_campaign_id && c.account_id && (
                          <button
                            className="btn btn-ghost btn-sm"
                            disabled={publishingId === c.id}
                            onClick={() => handlePublish(c)}
                          >
                            {publishingId === c.id ? <span className="spinner" /> : 'Publish'}
                          </button>
                        )}
                        {canScheduleMetaBudget(c) && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            title="Schedule high-demand budget boost on Meta (meta_create_budget_schedule)"
                            onClick={() => setBudgetScheduleCampaign(c)}
                          >
                            Budget boost
                          </button>
                        )}
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(c)}>Edit</button>
                        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleDelete(c)}>Del</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <MetaBudgetScheduleModal
        open={Boolean(budgetScheduleCampaign)}
        campaign={budgetScheduleCampaign}
        onClose={() => setBudgetScheduleCampaign(null)}
        onSuccess={() => toast.success('Budget schedule created on Meta')}
      />

      <Modal open={showForm} onClose={() => { setShowForm(false); setWizardPlatform(null) }}>
        <div className="modal" style={{ width: '100%', maxWidth: 560, maxHeight: 'min(90vh, 900px)', overflowY: 'auto', minWidth: 0 }}>
          <h2 className="modal-title" style={{ marginBottom: '1rem' }}>
            {editing ? 'Edit Campaign' : wizardPlatform ? `New ${PLATFORM_LABEL[wizardPlatform]} Campaign` : 'New Campaign'}
          </h2>
          {!editing && !wizardPlatform ? (
            <div>
              <p style={{ color: 'var(--fg-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>
                Choose a platform. Each has its own workflow — Meta and Google Ads are not interchangeable.
              </p>
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {PLATFORMS.map(p => (
                  <button
                    key={p}
                    type="button"
                    className="btn btn-secondary"
                    style={{ justifyContent: 'flex-start', padding: '1rem', borderColor: PLATFORM_COLOR[p] }}
                    onClick={() => setWizardPlatform(p)}
                  >
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: PLATFORM_COLOR[p], marginRight: '0.5rem' }} />
                    {PLATFORM_LABEL[p]}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              </div>
            </div>
          ) : !editing && wizardPlatform === 'google_ads' ? (
            <GoogleAdsCampaignWizard
              onCancel={() => { setWizardPlatform(null); setShowForm(false) }}
              onToast={(msg, type = 'success') => (type === 'error' ? toast.error(msg) : toast.success(msg))}
              onComplete={() => {
                setShowForm(false)
                setWizardPlatform(null)
                load()
              }}
            />
          ) : !editing && wizardPlatform ? (
            <AdsWorkflowStepper
              platform={wizardPlatform}
              onCancel={() => { setWizardPlatform(null); setShowForm(false) }}
              onToast={(msg, type = 'success') => (type === 'error' ? toast.error(msg) : toast.success(msg))}
              onComplete={(created) => {
                if (!created?.id) return
                setShowForm(false)
                setWizardPlatform(null)
                if (typeof window !== 'undefined') {
                  const q = new URLSearchParams(window.location.search)
                  q.set('platform', 'meta_ads')
                  window.history.replaceState(null, '', `${window.location.pathname}?${q}`)
                }
                load()
              }}
            />
          ) : (
          <form onSubmit={handleSave}>
              <div className="form-group">
                <label className="form-label">Campaign Name *</label>
                <input className="form-input" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Summer Promo 2026" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">Platform *</label>
                  <select className="form-input" value={form.platform} onChange={e => setForm(f => ({ ...f, platform: e.target.value }))}>
                    {PLATFORMS.map(p => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Type</label>
                  <select className="form-input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                    {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.75rem' }}>
                <div className="form-group" style={{ minWidth: 0 }}>
                  <label className="form-label">Budget Amount</label>
                  <input className="form-input" type="number" min="0" step="0.01" value={form.budget_amount} onChange={e => setForm(f => ({ ...f, budget_amount: e.target.value }))} placeholder="1000" />
                </div>
                <div className="form-group" style={{ minWidth: 0 }}>
                  <label className="form-label">Currency</label>
                  <select className="form-input" value={form.budget_currency} onChange={e => setForm(f => ({ ...f, budget_currency: e.target.value }))}>
                    {CURRENCY.map(cur => <option key={cur}>{cur}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ minWidth: 0 }}>
                  <label className="form-label">Budget Type</label>
                  <select className="form-input" value={form.budget_type} onChange={e => setForm(f => ({ ...f, budget_type: e.target.value }))}>
                    <option value="total">Total</option>
                    <option value="daily">Daily</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">Start Date</label>
                  <input className="form-input" type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">End Date</label>
                  <input className="form-input" type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
                </div>
              </div>
              {editing && (
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select className="form-input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Keywords (comma-separated)</label>
                <input className="form-input" value={form.keywords} onChange={e => setForm(f => ({ ...f, keywords: e.target.value }))} placeholder="marketing software, social media tool" />
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <span className="spinner" /> : editing ? 'Save Changes' : 'Create Campaign'}
                </button>
              </div>
            </form>
          )}
        </div>
      </Modal>
      <ConfirmDialogHost />
    </AppLayout>
  )
}

export default function CampaignsPage() {
  return (
    <Suspense fallback={<AppLayout><div className="skeleton" style={{ height: 200 }} /></AppLayout>}>
      <CampaignsPageContent />
    </Suspense>
  )
}
