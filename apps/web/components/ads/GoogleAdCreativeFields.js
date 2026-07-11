'use client'

/** RSA fields matching google_create_ad / creatives (reference create_responsive_search_ad). */
export default function GoogleAdCreativeFields({ values, setField }) {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">path1 (optional, max 15)</label>
          <input
            className="form-input"
            type="text"
            maxLength={15}
            value={values.path1 ?? ''}
            onChange={(e) => setField('path1', e.target.value)}
            placeholder="shop"
          />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">path2 (optional, max 15)</label>
          <input
            className="form-input"
            type="text"
            maxLength={15}
            value={values.path2 ?? ''}
            onChange={(e) => setField('path2', e.target.value)}
            placeholder="sale"
          />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">ad_status</label>
        <select
          className="form-input"
          value={values.ad_status ?? 'PAUSED'}
          onChange={(e) => setField('ad_status', e.target.value)}
        >
          <option value="PAUSED">PAUSED</option>
          <option value="ENABLED">ENABLED</option>
        </select>
        <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginTop: '0.35rem' }}>
          Maps to <code>creatives.ad_status</code> → <code>google_create_ad</code> / publish RSA status.
        </p>
      </div>
    </>
  )
}
