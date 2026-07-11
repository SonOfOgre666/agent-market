'use client'
import { useEffect, useState } from 'react'
import AppLayout from '../../components/AppLayout.js'
import { api } from '../../lib/api.js'
import { useToast } from '../../components/Toast.js'
import { useConfirmDialog } from '../../lib/useConfirmDialog.js'
import NewLandingPageWizard from '../../components/NewLandingPageWizard.js'
import { Globe, Sparkles, X as XIcon } from 'lucide-react'

const WEB_URL = process.env.NEXT_PUBLIC_WEB_URL || ''

const DEFAULT_FIELDS = [
  { name: 'name', type: 'text', label: 'Full Name', required: true },
  { name: 'email', type: 'email', label: 'Email Address', required: true },
  { name: 'phone', type: 'tel', label: 'Phone Number', required: false },
]

const EMPTY_FORM = {
  title: '', headline: '', subheadline: '', body: '',
  cta_text: 'Get Started', cta_url: '', status: 'draft',
  form_fields: DEFAULT_FIELDS,
}

export default function LandingPagesPage() {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showWizard, setShowWizard] = useState(false)
  const [editing, setEditing] = useState(null)
  const [showEditForm, setShowEditForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [copiedSlug, setCopiedSlug] = useState(null)
  const toast = useToast()
  const { confirm, ConfirmDialogHost } = useConfirmDialog()

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.landingPages({ per_page: 50 })
      setItems(res.items || [])
      setTotal(res.total || 0)
    } catch (e) { toast.error(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const openEdit = (p) => {
    setEditing(p)
    setForm({
      title: p.title, headline: p.headline, subheadline: p.subheadline,
      body: p.body, cta_text: p.cta_text, cta_url: p.cta_url,
      status: p.status, form_fields: p.form_fields || DEFAULT_FIELDS,
    })
    setShowEditForm(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.updateLandingPage(editing.id, form)
      toast.success('Landing page updated')
      setShowEditForm(false)
      load()
    } catch (e) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (p) => {
    const ok = await confirm({
      title: 'Delete landing page?',
      message: `Delete “${p.title}”? The public URL will stop working.`,
      confirmLabel: 'Delete',
    })
    if (!ok) return
    try {
      await api.deleteLandingPage(p.id)
      toast.success('Deleted')
      load()
    } catch (e) { toast.error(e.message) }
  }

  const handlePublish = async (p) => {
    try {
      await api.updateLandingPage(p.id, { status: p.status === 'published' ? 'draft' : 'published' })
      toast.success(p.status === 'published' ? 'Unpublished' : 'Published!')
      load()
    } catch (e) { toast.error(e.message) }
  }

  const copyLink = (slug) => {
    const url = `${WEB_URL}/lp/${slug}`
    navigator.clipboard.writeText(url)
    setCopiedSlug(slug)
    setTimeout(() => setCopiedSlug(null), 2000)
  }

  const addField = () => {
    setForm(f => ({ ...f, form_fields: [...f.form_fields, { name: `field_${Date.now()}`, type: 'text', label: '', required: false }] }))
  }

  const removeField = (i) => {
    setForm(f => ({ ...f, form_fields: f.form_fields.filter((_, idx) => idx !== i) }))
  }

  const updateField = (i, key, value) => {
    setForm(f => ({ ...f, form_fields: f.form_fields.map((fd, idx) => idx === i ? { ...fd, [key]: value } : fd) }))
  }

  return (
    <AppLayout>
      <div className="page-header-enhanced">
        <div className="page-header-content">
          <div className="page-header-title">
            <div className="page-header-icon">
              <Globe size={18} strokeWidth={2.5} />
            </div>
            <h1 className="page-title">Landing Pages</h1>
          </div>
          <p className="page-header-desc">{total} page{total !== 1 ? 's' : ''} — capture leads from your ad campaigns</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowWizard(true)}>
          <Sparkles size={15} /> New Page
        </button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {[1, 2].map(i => <div key={i} className="skeleton" style={{ height: 80 }} />)}
        </div>
      ) : items.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--fg-muted)' }}>
          <p style={{ marginBottom: '1rem' }}>No landing pages yet.</p>
          <button className="btn btn-primary" onClick={() => setShowWizard(true)}>
            <Sparkles size={15} /> Create your first page
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {items.map(p => (
            <div key={p.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{p.title}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginTop: '0.15rem', fontFamily: 'monospace' }}>
                  /lp/{p.slug}
                </div>
                {p.headline && <div style={{ fontSize: '0.8rem', color: 'var(--fg-muted)', marginTop: '0.25rem' }}>{p.headline}</div>}
              </div>
              <span style={{ fontSize: '0.8rem', fontWeight: 500, color: p.status === 'published' ? '#10b981' : '#64748b' }}>
                {p.status}
              </span>
              <span style={{ fontSize: '0.8rem', color: 'var(--fg-muted)' }}>{p.view_count || 0} visits</span>
              <span style={{ fontSize: '0.8rem', color: 'var(--fg-muted)' }}>{p.lead_count} leads</span>
              <div className="flex gap-1">
                <button className="btn btn-ghost btn-sm" onClick={() => copyLink(p.slug)}>
                  {copiedSlug === p.slug ? 'Copied!' : 'Copy Link'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => handlePublish(p)}>
                  {p.status === 'published' ? 'Unpublish' : 'Publish'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => openEdit(p)}>Edit</button>
                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleDelete(p)}>Del</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showWizard && (
        <div
          className="modal-overlay"
          style={{ zIndex: 1100, alignItems: 'flex-start', padding: '1rem' }}
          onClick={e => { if (e.target === e.currentTarget) setShowWizard(false) }}
        >
          <div
            className="modal animate-fade-in-up"
            style={{
              maxWidth: 800,
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
                  background: 'linear-gradient(135deg, hsl(152 60% 42% / 0.2), hsl(180 55% 40% / 0.15))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Globe size={13} color="hsl(152 60% 50%)" strokeWidth={2} />
                </div>
                <div>
                  <div style={{ fontSize: '0.875rem', fontWeight: 700 }}>Create landing page</div>
                  <div style={{ fontSize: '0.68rem', color: 'hsl(var(--fg-muted))' }}>Goal → plan → generate → edit → publish</div>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowWizard(false)} style={{ padding: '0.375rem' }}>
                <XIcon size={16} />
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <NewLandingPageWizard
                onClose={() => setShowWizard(false)}
                onDone={() => { setShowWizard(false); load() }}
              />
            </div>
          </div>
        </div>
      )}

      {showEditForm && editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div className="card" style={{ width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.25rem' }}>Edit Landing Page</h2>
            <form onSubmit={handleSave}>
              <div className="form-group">
                <label className="form-label">Page Title *</label>
                <input className="form-input" required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Headline</label>
                <input className="form-input" value={form.headline} onChange={e => setForm(f => ({ ...f, headline: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Subheadline</label>
                <input className="form-input" value={form.subheadline} onChange={e => setForm(f => ({ ...f, subheadline: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Body Text</label>
                <textarea className="form-input" rows={4} value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} style={{ resize: 'vertical' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">CTA Button Text</label>
                  <input className="form-input" value={form.cta_text} onChange={e => setForm(f => ({ ...f, cta_text: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select className="form-input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                  </select>
                </div>
              </div>
              <div style={{ marginTop: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label className="form-label" style={{ marginBottom: 0 }}>Lead Form Fields</label>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={addField}>+ Add Field</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {form.form_fields.map((fd, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 80px 32px', gap: '0.5rem', alignItems: 'center' }}>
                      <input className="form-input" style={{ marginBottom: 0 }} placeholder="Label" value={fd.label} onChange={e => updateField(i, 'label', e.target.value)} />
                      <select className="form-input" style={{ marginBottom: 0 }} value={fd.type} onChange={e => updateField(i, 'type', e.target.value)}>
                        <option value="text">Text</option>
                        <option value="email">Email</option>
                        <option value="tel">Phone</option>
                        <option value="number">Number</option>
                        <option value="textarea">Textarea</option>
                      </select>
                      <select className="form-input" style={{ marginBottom: 0 }} value={fd.required ? 'yes' : 'no'} onChange={e => updateField(i, 'required', e.target.value === 'yes')}>
                        <option value="yes">Required</option>
                        <option value="no">Optional</option>
                      </select>
                      <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)', padding: '0 0.5rem' }} onClick={() => removeField(i)}>✕</button>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowEditForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <span className="spinner" /> : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <ConfirmDialogHost />
    </AppLayout>
  )
}
