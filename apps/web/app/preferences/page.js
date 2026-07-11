'use client'

import { useEffect, useMemo, useState } from 'react'
import AppLayout from '../../components/AppLayout.js'
import RequireWorkspaceAdmin from '../../components/RequireWorkspaceAdmin.js'
import { api } from '../../lib/api.js'
import { useToast } from '../../components/Toast.js'
import { useWorkspaceSettings } from '../../components/WorkspaceSettingsProvider.js'
import {
  formatDateTime,
  normalizeWorkspaceSettings,
  settingsToApiPayload,
} from '../../lib/workspaceSettings.js'
import TimezoneSelect from '../../components/TimezoneSelect.js'
import CommentPlatformSupportNote from '../../components/CommentPlatformSupportNote.js'
import { Settings, Save, Clock, Calendar, Users, MessageSquare } from 'lucide-react'

const WEEK_OPTIONS = [
  { value: 1, label: 'Monday' },
  { value: 0, label: 'Sunday' },
  { value: 6, label: 'Saturday' },
]

export default function SettingsPage() {
  const toast = useToast()
  const { settings: liveSettings, refresh } = useWorkspaceSettings()
  const [form, setForm] = useState(() => normalizeWorkspaceSettings(liveSettings))
  const [accounts, setAccounts] = useState([])
  const [saving, setSaving] = useState(false)
  const [loadingAccounts, setLoadingAccounts] = useState(true)

  useEffect(() => {
    setForm(normalizeWorkspaceSettings(liveSettings))
  }, [liveSettings])

  useEffect(() => {
    api.accounts({ kind: 'social' })
      .then(setAccounts)
      .catch(console.error)
      .finally(() => setLoadingAccounts(false))
  }, [])

  const previewDate = useMemo(() => {
    const sample = new Date()
    sample.setHours(14, 30, 0, 0)
    return formatDateTime(sample.toISOString(), form)
  }, [form])

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = settingsToApiPayload(form)
      const saved = await api.saveSettings(payload)
      setForm(normalizeWorkspaceSettings(saved))
      await refresh()
      toast.success('Workspace preferences saved')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const toggleDefaultAccount = (id) => {
    setForm(f => {
      const current = f.default_accounts || []
      const next = current.includes(id)
        ? current.filter(x => x !== id)
        : [...current, id]
      return { ...f, default_accounts: next }
    })
  }

  return (
    <RequireWorkspaceAdmin>
    <AppLayout>
      <div className="page-header-enhanced">
        <div className="page-header-content">
          <div className="page-header-title">
            <div className="page-header-icon">
              <Settings size={18} strokeWidth={2.5} />
            </div>
            <h1 className="page-title">Preferences</h1>
          </div>
          <p className="page-header-desc">
            Timezone, date display, calendar layout, and default posting accounts for this workspace.
          </p>
        </div>
      </div>

      <div className="grid-2" style={{ maxWidth: 960, alignItems: 'start' }}>
        <div className="card">
          <form onSubmit={save}>
            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Clock size={16} /> Regional &amp; display
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="timezone">Timezone</label>
              <TimezoneSelect
                id="timezone"
                value={form.timezone}
                onChange={tz => setForm(s => ({ ...s, timezone: tz }))}
              />
              <p className="text-xs text-muted" style={{ marginTop: 6 }}>
                Calendar days, scheduling, and timestamps across the app use this timezone.
              </p>
            </div>

            <div className="form-group">
              <label className="form-label">Time format</label>
              <div className="flex gap-3">
                {[[12, '12-hour (2:30 PM)'], [24, '24-hour (14:30)']].map(([v, l]) => (
                  <label key={v} className="flex items-center gap-2" style={{ cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="time_format"
                      value={v}
                      checked={Number(form.time_format) === v}
                      onChange={() => setForm(s => ({ ...s, time_format: v }))}
                    />
                    <span className="text-sm">{l}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Date display</label>
              <div className="flex gap-3">
                {[['human', 'Relative (Today at 2:30 PM, 3 days ago)'], ['full', 'Always absolute']].map(([v, l]) => (
                  <label key={v} className="flex items-center gap-2" style={{ cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="date_format"
                      value={v}
                      checked={form.date_format === v}
                      onChange={() => setForm(s => ({ ...s, date_format: v }))}
                    />
                    <span className="text-sm">{l}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Week starts on</label>
              <select
                className="form-input"
                value={form.week_starts_on}
                onChange={e => setForm(s => ({ ...s, week_starts_on: Number(e.target.value) }))}
              >
                {WEEK_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <p className="text-xs text-muted" style={{ marginTop: 6 }}>
                Controls the calendar grid column order.
              </p>
            </div>

            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: '1.5rem' }}>
              <MessageSquare size={16} /> Comment inbox
            </div>

            <div className="form-group">
              <label className="flex items-center gap-2" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.auto_analyze_comments === true}
                  onChange={(e) => setForm((s) => ({ ...s, auto_analyze_comments: e.target.checked }))}
                />
                <span className="text-sm">Auto-analyze comments when synced from platforms</span>
              </label>
              <p className="text-xs text-muted" style={{ marginTop: 6 }}>
                When enabled, newly synced comments are analyzed automatically. Applies only to platforms that support comment sync.
              </p>
              <div style={{ marginTop: 12 }}>
                <CommentPlatformSupportNote variant="detail" />
              </div>
            </div>

            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: '1.5rem' }}>
              <Users size={16} /> Posting defaults
            </div>

            <div className="form-group">
              <label className="form-label">Default accounts for new posts</label>
              {loadingAccounts ? (
                <p className="text-muted text-sm">Loading accounts…</p>
              ) : accounts.length === 0 ? (
                <p className="text-muted text-sm">Connect social accounts first under Accounts.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
                  {accounts.map(acc => (
                    <label key={acc.id} className="flex items-center gap-2" style={{ cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={(form.default_accounts || []).includes(acc.id)}
                        onChange={() => toggleDefaultAccount(acc.id)}
                      />
                      <span className="text-sm">{acc.name || acc.username || acc.id}</span>
                      {acc.provider && (
                        <span className="text-xs text-muted">({acc.provider})</span>
                      )}
                    </label>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted" style={{ marginTop: 6 }}>
                Pre-selected when you create a new post (you can still change them in the editor).
              </p>
            </div>

            <button className="btn btn-primary" type="submit" disabled={saving} style={{ marginTop: '0.5rem' }}>
              {saving ? <span className="spinner" /> : <><Save size={14} strokeWidth={2} /> Save preferences</>}
            </button>
          </form>
        </div>

        <div className="card">
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Calendar size={16} /> Live preview
          </div>
          <p className="text-sm text-muted" style={{ marginBottom: '1rem' }}>
            These preferences apply across the calendar, posts list, editor, leads, and team pages.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="glass-card" style={{ padding: '1rem' }}>
              <div className="text-xs text-muted" style={{ marginBottom: 4 }}>Scheduled time</div>
              <div style={{ fontWeight: 600 }}>{previewDate}</div>
            </div>
            <div className="glass-card" style={{ padding: '1rem' }}>
              <div className="text-xs text-muted" style={{ marginBottom: 4 }}>Calendar week header</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
                  .slice(form.week_starts_on)
                  .concat(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].slice(0, form.week_starts_on))
                  .map(d => (
                    <span key={d} className="ai-tip-chip">{d}</span>
                  ))}
              </div>
            </div>
            <div className="glass-card" style={{ padding: '1rem' }}>
              <div className="text-xs text-muted" style={{ marginBottom: 4 }}>Default accounts</div>
              <div style={{ fontWeight: 600 }}>
                {(form.default_accounts || []).length
                  ? `${form.default_accounts.length} account(s) pre-selected`
                  : 'None — pick accounts manually each time'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
    </RequireWorkspaceAdmin>
  )
}
