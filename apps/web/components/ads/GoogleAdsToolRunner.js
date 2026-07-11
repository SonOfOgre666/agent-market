'use client'

import { useMemo, useState } from 'react'
import { runGoogleTool } from '../../lib/googleAdsTools.js'
import { buildToolPayload } from '../../lib/googleAdsToolCatalog.js'
import {
  GOOGLE_ADGROUP_SCOPED_TOOLS,
  GOOGLE_CAMPAIGN_SCOPED_TOOLS,
  GOOGLE_SMART_CHAINS,
} from '../../lib/googleAdsSmartChains.js'
import { Play, AlertCircle, CheckCircle2 } from 'lucide-react'

function FieldInput({ field, value, onChange }) {
  if (field.type === 'textarea') {
    return (
      <textarea
        className="form-input"
        rows={4}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder || field.hint}
        required={field.required}
      />
    )
  }
  if (field.type === 'select') {
    return (
      <select className="form-input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} required={field.required}>
        <option value="">—</option>
        {(field.options || []).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    )
  }
  return (
    <input
      className="form-input"
      type={field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : 'text'}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder || field.hint}
      required={field.required}
    />
  )
}

/** Execute a single catalog tool via POST /ads/tools/execute */
export default function GoogleAdsToolRunner({ tool, context, onResult, onToast }) {
  const [form, setForm] = useState({})
  const [running, setRunning] = useState(false)
  const [lastResult, setLastResult] = useState(null)
  const [lastError, setLastError] = useState(null)

  const canRun = tool?.implemented && tool?.toolId && context?.accountId

  const chainHint = useMemo(() => {
    if (!tool?.toolId) return null
    for (const chain of GOOGLE_SMART_CHAINS) {
      const idx = chain.toolIds.indexOf(tool.toolId)
      if (idx >= 0 && idx < chain.toolIds.length - 1) {
        return { chain: chain.label, nextToolId: chain.toolIds[idx + 1] }
      }
    }
    return null
  }, [tool?.toolId])

  const setField = (name, val) => setForm((f) => ({ ...f, [name]: val }))

  const prefillFromContext = () => {
    const patch = {}
    if (context?.platformCampaignId && GOOGLE_CAMPAIGN_SCOPED_TOOLS.has(tool?.toolId)) {
      patch.platform_campaign_id = context.platformCampaignId
    }
    if (context?.platformAdSetId && GOOGLE_ADGROUP_SCOPED_TOOLS.has(tool?.toolId)) {
      patch.platform_ad_set_id = context.platformAdSetId
    }
    setForm((f) => ({ ...f, ...patch }))
  }

  const handleRun = async () => {
    if (!canRun) return
    setRunning(true)
    setLastError(null)
    setLastResult(null)
    try {
      const payload = buildToolPayload(tool, form, context)
      const out = await runGoogleTool(tool.toolId, payload)
      setLastResult(out)
      onResult?.(tool, out)
      onToast?.(`${tool.label} completed`, 'success')
    } catch (e) {
      setLastError(e.message)
      onToast?.(e.message, 'error')
    } finally {
      setRunning(false)
    }
  }

  const resultPreview = useMemo(() => {
    if (!lastResult) return null
    try {
      return JSON.stringify(lastResult, null, 2)
    } catch {
      return String(lastResult)
    }
  }, [lastResult])

  if (!tool) {
    return (
      <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--fg-muted)' }}>
        Select a tool from the catalog
      </div>
    )
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>{tool.label}</h3>
          <code style={{ fontSize: '0.7rem', color: 'var(--fg-muted)' }}>{tool.ref}</code>
          {tool.toolId && (
            <code style={{ fontSize: '0.7rem', background: 'var(--surface-2)', padding: '0.15rem 0.4rem', borderRadius: 4 }}>
              {tool.toolId}
            </code>
          )}
          {!tool.implemented && (
            <span style={{ fontSize: '0.7rem', color: 'var(--warning, #b45309)' }}>Not ported yet</span>
          )}
        </div>
        <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: 'var(--fg-muted)' }}>{tool.description}</p>
      </div>

      {!context?.accountId && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--warning, #b45309)', fontSize: '0.85rem' }}>
          <AlertCircle size={16} /> Connect a Google Ads account in step 1
        </div>
      )}

      {(tool.fields || []).map((field) => (
        <div key={field.name} className="form-group">
          <label className="form-label">
            {field.label}{field.required ? ' *' : ''}
          </label>
          <FieldInput field={field} value={form[field.name]} onChange={(v) => setField(field.name, v)} />
          {field.hint && (
            <p style={{ fontSize: '0.72rem', color: 'var(--fg-muted)', marginTop: '0.25rem' }}>{field.hint}</p>
          )}
        </div>
      ))}

      {chainHint && (
        <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', margin: 0 }}>
          Chain <strong>{chainHint.chain}</strong> → next: <code>{chainHint.nextToolId}</code>
        </p>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary" disabled={!canRun || running} onClick={handleRun}>
          <Play size={14} /> {running ? 'Running…' : 'Run tool'}
        </button>
        {(context?.platformCampaignId || context?.platformAdSetId) && (
          <button type="button" className="btn btn-secondary" onClick={prefillFromContext}>
            Use context IDs
          </button>
        )}
      </div>

      {lastError && (
        <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{lastError}</div>
      )}
      {lastResult && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', color: 'var(--success, #10b981)', marginBottom: '0.35rem' }}>
            <CheckCircle2 size={14} /> Response
          </div>
          <pre
            style={{
              margin: 0,
              padding: '0.75rem',
              background: 'var(--surface-2)',
              borderRadius: 8,
              fontSize: '0.72rem',
              maxHeight: 240,
              overflow: 'auto',
            }}
          >
            {resultPreview}
          </pre>
        </div>
      )}
    </div>
  )
}
