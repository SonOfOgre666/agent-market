'use client'

import { useEffect, useState } from 'react'
import Modal from '../Modal.js'
import { useConfirmDialog } from '../../lib/useConfirmDialog.js'
import { useWorkspaceSettings } from '../WorkspaceSettingsProvider.js'
import { createMetaBudgetSchedule } from '../../lib/metaAdsTools.js'

const EMPTY = {
  budget_value_type: 'ABSOLUTE',
  budget_value: '',
  time_start_local: '',
  time_end_local: '',
}

function datetimeLocalToUnix(local, toIso) {
  if (!local) return null
  const iso = toIso(local)
  if (!iso) return null
  return Math.floor(new Date(iso).getTime() / 1000)
}

/** Default window: tomorrow 00:00 → tomorrow 23:59 (local). */
function defaultDatetimeLocals() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return {
    time_start_local: `${y}-${m}-${day}T00:00`,
    time_end_local: `${y}-${m}-${day}T23:59`,
  }
}

/**
 * Schedule a Meta high-demand budget boost on a published campaign (meta_create_budget_schedule).
 */
export default function MetaBudgetScheduleModal({ open, campaign, onClose, onSuccess }) {
  const { confirm, ConfirmDialogHost } = useConfirmDialog()
  const { formatDateTime, datetimeLocalValueToIso, settings } = useWorkspaceSettings()
  const [form, setForm] = useState(EMPTY)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setForm({ ...EMPTY, ...defaultDatetimeLocals() })
  }, [open, campaign?.id])

  const setField = (name, value) => setForm((f) => ({ ...f, [name]: value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    if (!campaign?.account_id) {
      setError('This campaign has no connected Meta account.')
      return
    }
    if (!campaign?.platform_campaign_id) {
      setError('Publish the campaign to Meta first (platform campaign id required).')
      return
    }
    const budgetValue = parseInt(form.budget_value, 10)
    if (!Number.isFinite(budgetValue) || budgetValue <= 0) {
      setError('Enter a positive budget value.')
      return
    }
    const timeStart = datetimeLocalToUnix(form.time_start_local, datetimeLocalValueToIso)
    const timeEnd = datetimeLocalToUnix(form.time_end_local, datetimeLocalValueToIso)
    if (timeStart == null || timeEnd == null) {
      setError('Start and end date/time are required.')
      return
    }
    if (timeEnd <= timeStart) {
      setError('End time must be after start time.')
      return
    }
    const typeLabel = form.budget_value_type === 'MULTIPLIER' ? `×${budgetValue}` : `${budgetValue} (smallest currency unit, e.g. cents for USD)`
    const ok = await confirm({
      title: 'Schedule budget boost?',
      message:
        `Schedule a high-demand budget boost on “${campaign.name}”?\n\n` +
        `Type: ${form.budget_value_type}\nValue: ${typeLabel}\n` +
        `Window: ${formatDateTime(new Date(timeStart * 1000).toISOString())} → ${formatDateTime(new Date(timeEnd * 1000).toISOString())}\n\n` +
        'This changes live spend on Meta and may increase cost.',
      confirmLabel: 'Schedule on Meta',
      variant: 'primary',
    })
    if (!ok) return
    setSubmitting(true)
    try {
      const out = await createMetaBudgetSchedule(campaign.account_id, {
        campaign_id: String(campaign.platform_campaign_id),
        budget_value: budgetValue,
        budget_value_type: form.budget_value_type,
        time_start: timeStart,
        time_end: timeEnd,
      })
      onSuccess?.(out)
      onClose?.()
    } catch (err) {
      setError(err.message || 'Failed to create budget schedule')
    } finally {
      setSubmitting(false)
    }
  }

  if (!campaign) return null

  return (
    <>
    <Modal open={open} onClose={onClose}>
      <div className="modal" style={{ width: '100%', maxWidth: 480, minWidth: 0 }}>
        <h2 className="modal-title" style={{ marginBottom: '0.35rem' }}>High-demand budget boost</h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--fg-muted)', marginBottom: '1rem' }}>
          Schedules extra budget on Meta for a fixed window (<code>meta_create_budget_schedule</code>). Campaign:{' '}
          <strong>{campaign.name}</strong>
          {campaign.platform_campaign_id ? (
            <span style={{ display: 'block', marginTop: '0.25rem' }}>
              Meta id: <code>{campaign.platform_campaign_id}</code>
            </span>
          ) : null}
        </p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Boost type *</label>
            <select
              className="form-input"
              value={form.budget_value_type}
              onChange={(e) => setField('budget_value_type', e.target.value)}
            >
              <option value="ABSOLUTE">Absolute — add fixed amount (cents for USD)</option>
              <option value="MULTIPLIER">Multiplier — e.g. 2 doubles budget for the window</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">
              {form.budget_value_type === 'MULTIPLIER' ? 'Multiplier *' : 'Budget increase (cents) *'}
            </label>
            <input
              className="form-input"
              type="number"
              min={1}
              step={1}
              required
              value={form.budget_value}
              onChange={(e) => setField('budget_value', e.target.value)}
              placeholder={form.budget_value_type === 'MULTIPLIER' ? '2' : '10000'}
            />
            {form.budget_value_type === 'ABSOLUTE' && (
              <p style={{ fontSize: '0.72rem', color: 'var(--fg-muted)', marginTop: '0.35rem' }}>
                Meta uses the account&apos;s smallest currency unit. Example: 10000 = $100.00 USD.
              </p>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div className="form-group">
              <label className="form-label">Start (local) *</label>
              <input
                className="form-input"
                type="datetime-local"
                required
                value={form.time_start_local}
                onChange={(e) => setField('time_start_local', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">End (local) *</label>
              <input
                className="form-input"
                type="datetime-local"
                required
                value={form.time_end_local}
                onChange={(e) => setField('time_end_local', e.target.value)}
              />
            </div>
          </div>
          <p style={{ fontSize: '0.72rem', color: 'var(--fg-muted)', marginTop: '0.35rem' }}>
            Times are in workspace timezone ({settings.timezone.replace(/_/g, ' ')}).
          </p>
          {error && (
            <p style={{ color: 'var(--danger)', fontSize: '0.8rem', marginBottom: '0.75rem' }}>{error}</p>
          )}
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? <span className="spinner" /> : 'Schedule on Meta'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
    <ConfirmDialogHost />
    </>
  )
}
