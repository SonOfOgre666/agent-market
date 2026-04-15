'use client'
import { useEffect, useState } from 'react'
import AppLayout from '../../../components/AppLayout.js'
import { api } from '../../../lib/api.js'
import { useToast } from '../../../components/Toast.js'

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
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [copiedSlug, setCopiedSlug] = useState(null)
  const toast = useToast()

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

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setShowForm(true) }
  const openEdit = (p) => {
    setEditing(p)
    setForm({
      title: p.title, headline: p.headline, subheadline: p.subheadline,
      body: p.body, cta_text: p.cta_text, cta_url: p.cta_url,
      status: p.status, form_fields: p.form_fields || DEFAULT_FIELDS,
    })
    setShowForm(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (editing) {
        await api.updateLandingPage(editing.id, form)
        toast.success('Landing page updated')
      } else {
        await api.createLandingPage(form)
        toast.success('Landing page created')
      }
      setShowForm(false)
      load()
    } catch (e) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (p) => {
    if (!confirm(`Delete "${p.title}"?`)) return
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
      <div className="page-header">
        <div>
          <h1 className="page-title">Landing Pages</h1>
          <p style={{ color: 'var(--fg-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>{total} page{total !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ New Page</button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {[1,2].map(i => <div key={i} className="skeleton" style={{ height: 80 }} />)}
        </div>
      ) : items.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--fg-muted)' }}>
          No landing pages yet. Create one to start capturing leads.
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

      {/* Form modal */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div className="card" style={{ width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.25rem' }}>
              {editing ? 'Edit Landing Page' : 'New Landing Page'}
            </h2>
            <form onSubmit={handleSave}>
              <div className="form-group">
                <label className="form-label">Page Title *</label>
                <input className="form-input" required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Get 30% Off — Limited Offer" />
              </div>
              <div className="form-group">
                <label className="form-label">Headline</label>
                <input className="form-input" value={form.headline} onChange={e => setForm(f => ({ ...f, headline: e.target.value }))} placeholder="Transform Your Marketing Today" />
              </div>
              <div className="form-group">
                <label className="form-label">Subheadline</label>
                <input className="form-input" value={form.subheadline} onChange={e => setForm(f => ({ ...f, subheadline: e.target.value }))} placeholder="Join 10,000+ marketers already saving time" />
              </div>
              <div className="form-group">
                <label className="form-label">Body Text</label>
                <textarea className="form-input" rows={4} value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} placeholder="Describe your offer..." style={{ resize: 'vertical' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">CTA Button Text</label>
                  <input className="form-input" value={form.cta_text} onChange={e => setForm(f => ({ ...f, cta_text: e.target.value }))} placeholder="Get Started" />
                </div>
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select className="form-input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                  </select>
                </div>
              </div>

              {/* Form fields editor */}
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
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <span className="spinner" /> : editing ? 'Save Changes' : 'Create Page'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
