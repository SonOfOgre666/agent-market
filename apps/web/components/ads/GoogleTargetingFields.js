'use client'

import { GOOGLE_GEO_PRESETS } from '../../lib/googleGeoConstants.js'
import { normalizeGoogleFormValues } from '../../lib/googleAdsWorkflow.js'

/** Targeting step — fields match google_create_geo_targeting / exclude / geo_target_type / negatives tools. */
export default function GoogleTargetingFields({ values, setField }) {
  const v = normalizeGoogleFormValues(values)
  const selected = Array.isArray(v.geo_target_constant_ids) ? v.geo_target_constant_ids : []
  const excluded = Array.isArray(v.excluded_geo_target_constant_ids)
    ? v.excluded_geo_target_constant_ids
    : []

  const toggleGeo = (listName, id) => {
    const cur = Array.isArray(values[listName]) ? [...values[listName]] : []
    const n = Number(id)
    const next = cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]
    setField(listName, next)
  }

  const mergeExtraGeoIds = (raw) => {
    setField('geo_target_constant_ids_extra', raw)
    const presetIds = GOOGLE_GEO_PRESETS.map((p) => p.id)
    const checkedPresets = presetIds.filter((id) => (values.geo_target_constant_ids || []).includes(id))
    const extra = String(raw || '')
      .split(/[\s,]+/)
      .map((p) => p.trim())
      .filter((p) => /^\d+$/.test(p))
      .map(Number)
    setField('geo_target_constant_ids', [...new Set([...checkedPresets, ...extra])])
  }

  return (
    <>
      <div className="form-group">
        <label className="form-label">
          geo_target_constant_ids <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}>(target)</span>
        </label>
        <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginBottom: '0.5rem' }}>
          Applied on publish via <code>google_create_geo_targeting</code>. US = 2840, Canada = 2124.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {GOOGLE_GEO_PRESETS.map((p) => (
            <label
              key={p.id}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.35rem 0.6rem',
                borderRadius: 6,
                border: '1px solid var(--border)',
                cursor: 'pointer',
                background: selected.includes(p.id) ? 'var(--accent-muted, rgba(99,102,241,0.12))' : 'transparent',
              }}
            >
              <input
                type="checkbox"
                checked={selected.includes(p.id)}
                onChange={() => toggleGeo('geo_target_constant_ids', p.id)}
              />
              {p.label} ({p.id})
            </label>
          ))}
        </div>
        <input
          className="form-input"
          style={{ marginTop: '0.5rem' }}
          type="text"
          value={values.geo_target_constant_ids_extra ?? ''}
          onChange={(e) => mergeExtraGeoIds(e.target.value)}
          placeholder="More IDs: 2840, 2124 (comma-separated digits only)"
        />
      </div>

      <div className="form-group">
        <label className="form-label">
          excluded_geo_target_constant_ids <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}>(optional)</span>
        </label>
        <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginBottom: '0.5rem' }}>
          <code>google_exclude_geo_targets</code> — same ID format as targets.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {GOOGLE_GEO_PRESETS.map((p) => (
            <label
              key={`ex-${p.id}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.35rem 0.6rem',
                borderRadius: 6,
                border: '1px solid var(--border)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={excluded.includes(p.id)}
                onChange={() => toggleGeo('excluded_geo_target_constant_ids', p.id)}
              />
              Exclude {p.label} ({p.id})
            </label>
          ))}
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">positive_geo_target_type</label>
        <select
          className="form-input"
          value={values.positive_geo_target_type ?? ''}
          onChange={(e) => setField('positive_geo_target_type', e.target.value)}
        >
          <option value="">(default — PRESENCE_OR_INTEREST)</option>
          <option value="PRESENCE">PRESENCE — people in targeted locations</option>
          <option value="PRESENCE_OR_INTEREST">PRESENCE_OR_INTEREST</option>
          <option value="SEARCH_INTEREST">SEARCH_INTEREST — search interest in locations</option>
        </select>
        <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginTop: '0.35rem' }}>
          <code>google_update_campaign_geo_target</code>
        </p>
      </div>

      <div className="form-group">
        <label className="form-label">negative_geo_target_type</label>
        <select
          className="form-input"
          value={values.negative_geo_target_type ?? ''}
          onChange={(e) => setField('negative_geo_target_type', e.target.value)}
        >
          <option value="">(default)</option>
          <option value="PRESENCE">PRESENCE</option>
          <option value="PRESENCE_OR_INTEREST">PRESENCE_OR_INTEREST</option>
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">keywords (campaign negatives)</label>
        <textarea
          className="form-input"
          rows={3}
          value={values.negative_keywords ?? ''}
          onChange={(e) => setField('negative_keywords', e.target.value)}
          placeholder="free, fake, replica"
        />
        <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginTop: '0.35rem' }}>
          Broad match negatives via <code>google_add_negative_keywords</code> (payload field: <code>keywords</code>).
        </p>
      </div>
    </>
  )
}
