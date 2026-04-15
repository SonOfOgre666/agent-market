'use client'
import { useEffect, useState } from 'react'
import AppLayout from '../../../components/AppLayout.js'
import { api } from '../../../lib/api.js'
import { useToast } from '../../../components/Toast.js'

const PLATFORMS = ['google_ads', 'facebook', 'linkedin', 'tiktok', 'instagram']
const PLATFORM_LABEL = {
  google_ads: 'Google Ads', facebook: 'Facebook', linkedin: 'LinkedIn',
  tiktok: 'TikTok', instagram: 'Instagram',
}
const PLATFORM_COLOR = {
  google_ads: '#4285f4', facebook: '#1877f2', linkedin: '#0a66c2',
  tiktok: '#ff0050', instagram: '#e1306c',
}
const STATUS_COLOR = { draft: '#64748b', active: '#10b981', paused: '#f59e0b', ended: '#ef4444' }
const STATUSES = ['draft', 'active', 'paused', 'ended']
const TYPES = ['search', 'display', 'video', 'social']
const CURRENCY = ['USD', 'EUR', 'GBP', 'MAD', 'AED']

const EMPTY_FORM = { name: '', platform: 'facebook', type: 'social', budget_amount: '', budget_currency: 'USD', budget_type: 'total', start_date: '', end_date: '', keywords: '' }

export default function CampaignsPage() {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null) // campaign object
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')
  const toast = useToast()

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.campaigns({ status: filterStatus || undefined, per_page: 50 })
      setItems(res.items || [])
      setTotal(res.total || 0)
    } catch (e) { toast.error(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [filterStatus])

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setShowForm(true) }
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
    if (!confirm(`Delete campaign "${c.name}"?`)) return
    try {
      await api.deleteCampaign(c.id)
      toast.success('Campaign deleted')
      load()
    } catch (e) { toast.error(e.message) }
  }

  const syncGoogleAds = async () => {
    try {
      const res = await api.syncGoogleAdsCampaigns()
      toast.success(`Synced ${res.synced} campaign(s) from Google Ads`)
      load()
    } catch (e) { toast.error(e.message) }
  }

  const setMetrics = async (c) => {
    const spend = prompt('Enter total spend ($):', c.metrics?.spend || 0)
    if (spend === null) return
    const impressions = prompt('Enter impressions:', c.metrics?.impressions || 0)
    if (impressions === null) return
    const clicks = prompt('Enter clicks:', c.metrics?.clicks || 0)
    if (clicks === null) return
    const conversions = prompt('Enter conversions:', c.metrics?.conversions || 0)
    if (conversions === null) return
    try {
      await api.updateCampaign(c.id, {
        metrics: {
          spend: parseFloat(spend) || 0,
          impressions: parseInt(impressions) || 0,
          clicks: parseInt(clicks) || 0,
          conversions: parseInt(conversions) || 0,
        }
      })
      toast.success('Metrics updated')
      load()
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
          No campaigns yet. Create your first campaign to get started.
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
                    </td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--fg-muted)' }}>
                      {c.start_date ? new Date(c.start_date).toLocaleDateString() : '—'}
                      {c.end_date ? ` → ${new Date(c.end_date).toLocaleDateString()}` : ''}
                    </td>
                    <td>
                      <div className="flex gap-1">
                        <button className="btn btn-ghost btn-sm" onClick={() => setMetrics(c)}>Metrics</button>
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

      {/* Create / Edit modal */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div className="card" style={{ width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.25rem' }}>
              {editing ? 'Edit Campaign' : 'New Campaign'}
            </h2>
            <form onSubmit={handleSave}>
              <div className="form-group">
                <label className="form-label">Campaign Name *</label>
                <input className="form-input" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Summer Promo 2026" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group" style={{ gridColumn: '1' }}>
                  <label className="form-label">Budget Amount</label>
                  <input className="form-input" type="number" min="0" step="0.01" value={form.budget_amount} onChange={e => setForm(f => ({ ...f, budget_amount: e.target.value }))} placeholder="1000" />
                </div>
                <div className="form-group">
                  <label className="form-label">Currency</label>
                  <select className="form-input" value={form.budget_currency} onChange={e => setForm(f => ({ ...f, budget_currency: e.target.value }))}>
                    {CURRENCY.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Budget Type</label>
                  <select className="form-input" value={form.budget_type} onChange={e => setForm(f => ({ ...f, budget_type: e.target.value }))}>
                    <option value="total">Total</option>
                    <option value="daily">Daily</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
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
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <span className="spinner" /> : editing ? 'Save Changes' : 'Create Campaign'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
