'use client'
import { useEffect, useState } from 'react'
import AppLayout from '../../components/AppLayout.js'
import { api } from '../../lib/api.js'
import { useToast } from '../../components/Toast.js'

const TIMEZONES = ['UTC', 'America/New_York', 'America/Los_Angeles', 'America/Chicago', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Shanghai', 'Australia/Sydney']

export default function SettingsPage() {
  const [settings, setSettings] = useState({ timezone: 'UTC', time_format: '12', week_starts_on: 'monday' })
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  useEffect(() => { api.settings().then(setSettings).catch(console.error) }, [])

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.saveSettings(settings)
      toast.success('Settings saved')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppLayout>
      <div className="page-header"><h1 className="page-title">Settings</h1></div>
      <div className="card" style={{ maxWidth: 520 }}>
        <form onSubmit={save}>
          <div className="form-group">
            <label className="form-label">Timezone</label>
            <select className="form-input" value={settings.timezone} onChange={e => setSettings(s => ({ ...s, timezone: e.target.value }))}>
              {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Time Format</label>
            <div className="flex gap-3">
              {[['12', '12-hour (2:30 PM)'], ['24', '24-hour (14:30)']].map(([v, l]) => (
                <label key={v} className="flex items-center gap-2" style={{ cursor: 'pointer' }}>
                  <input type="radio" name="time_format" value={v} checked={settings.time_format === v} onChange={() => setSettings(s => ({ ...s, time_format: v }))} />
                  <span className="text-sm">{l}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Week Starts On</label>
            <select className="form-input" value={settings.week_starts_on} onChange={e => setSettings(s => ({ ...s, week_starts_on: e.target.value }))}>
              <option value="monday">Monday</option>
              <option value="sunday">Sunday</option>
              <option value="saturday">Saturday</option>
            </select>
          </div>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? <span className="spinner" /> : 'Save Settings'}
          </button>
        </form>
      </div>
    </AppLayout>
  )
}
