'use client'

/** Ad group step — adgroup_status + cpc_bid_micros (google_create_adgroup / publish chain). */
export default function GoogleAdGroupFields({ values, setField }) {
  const cpcDollars =
    values.cpc_bid_micros != null && values.cpc_bid_micros !== ''
      ? Number(values.cpc_bid_micros) / 1_000_000
      : values.cpc_bid != null && values.cpc_bid !== ''
        ? Number(values.cpc_bid)
        : ''

  const setCpcFromDollars = (raw) => {
    setField('cpc_bid', raw)
    const n = parseFloat(raw)
    if (Number.isFinite(n) && n > 0) {
      setField('cpc_bid_micros', Math.round(n * 1_000_000))
    } else {
      setField('cpc_bid_micros', '')
    }
  }

  return (
    <>
      <div className="form-group">
        <label className="form-label">adgroup_status</label>
        <select
          className="form-input"
          value={values.adgroup_status ?? 'PAUSED'}
          onChange={(e) => setField('adgroup_status', e.target.value)}
        >
          <option value="PAUSED">Paused (recommended until review)</option>
          <option value="ENABLED">Enabled</option>
        </select>
        <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginTop: '0.35rem' }}>
          Maps to <code>google_create_adgroup</code> / publish chain (reference default is ENABLED; we default to
          paused for safety, same idea as Meta publish).
        </p>
      </div>
      <div className="form-group">
        <label className="form-label">cpc_bid_micros (optional)</label>
        <input
          className="form-input"
          type="number"
          min="0.01"
          step="0.01"
          value={cpcDollars}
          onChange={(e) => setCpcFromDollars(e.target.value)}
          placeholder="1.00"
        />
        <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginTop: '0.35rem' }}>
          Sent as <code>cpc_bid_micros</code> (1,000,000 = $1.00). Reference default: $1.00.
        </p>
      </div>
    </>
  )
}
