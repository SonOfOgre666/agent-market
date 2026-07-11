'use client'

import { useState } from 'react'
import { lookupGoogleReportingFields } from '../../lib/googleAdsTools.js'

/** GAQL field documentation lookup (agent tool: google_docs_reporting_fields). */
export default function GoogleGaqlFieldLookup({ accountId }) {
  const [input, setInput] = useState('campaign.name\nmetrics.clicks\nad_group.id')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const runLookup = async () => {
    const fields = input
      .split(/[\n,]+/)
      .map((f) => f.trim())
      .filter(Boolean)
    if (!fields.length) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const out = await lookupGoogleReportingFields(accountId, fields)
      setResult(out)
    } catch (e) {
      setError(e.message || 'Lookup failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="card"
      style={{ marginTop: '1rem', padding: '1rem', border: '1px solid var(--border)' }}
    >
      <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>GAQL field documentation</h3>
      <p style={{ fontSize: '0.8rem', color: 'var(--fg-muted)', marginBottom: '0.75rem' }}>
        Look up reporting field metadata (same path as the AI agent: <code>google_docs_reporting_fields</code>).
      </p>
      <textarea
        className="form-input"
        rows={3}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="campaign.name, metrics.clicks"
      />
      <button
        type="button"
        className="btn btn-secondary"
        style={{ marginTop: '0.5rem' }}
        disabled={loading || !accountId}
        onClick={runLookup}
      >
        {loading ? 'Loading…' : 'Look up fields'}
      </button>
      {error && (
        <p style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '0.5rem' }}>{error}</p>
      )}
      {result?.fields && (
        <pre
          style={{
            marginTop: '0.75rem',
            fontSize: '0.7rem',
            maxHeight: 280,
            overflow: 'auto',
            padding: '0.75rem',
            background: 'var(--bg-subtle, rgba(0,0,0,0.04))',
            borderRadius: 6,
          }}
        >
          {JSON.stringify(result.fields, null, 2)}
        </pre>
      )}
      {result?.content && !result?.fields && (
        <pre
          style={{
            marginTop: '0.75rem',
            fontSize: '0.7rem',
            maxHeight: 280,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
          }}
        >
          {result.content}
        </pre>
      )}
    </div>
  )
}
