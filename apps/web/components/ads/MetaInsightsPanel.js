'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { api } from '../../lib/api.js'
import {
  META_ACTION_BREAKDOWN_MODES,
  META_ATTRIBUTION_WINDOWS,
  META_BREAKDOWNS,
  META_INSIGHT_LEVELS,
  META_SCOPE_TYPES,
  META_TIME_PRESETS,
  DEFAULT_META_INSIGHTS_QUERY,
  buildMetaInsightsQuery,
  collectInsightColumns,
  formatInsightCell,
  metaActId,
} from '../../lib/metaInsightsUi.js'

function Field({ label, children, hint }) {
  return (
    <div className="form-group" style={{ marginBottom: 0 }}>
      <label className="form-label" style={{ fontSize: '0.75rem' }}>{label}</label>
      {children}
      {hint && (
        <p style={{ fontSize: '0.68rem', color: 'var(--fg-muted)', marginTop: '0.25rem', marginBottom: 0 }}>
          {hint}
        </p>
      )}
    </div>
  )
}

/**
 * Meta-only insights explorer (meta_report_insights). Used from /ads/performance when a Meta account is selected.
 */
export default function MetaInsightsPanel({ connection, onToast }) {
  const actId = metaActId(connection?.ad_account_id)
  const mongoAccountId = connection?.account_id

  const [query, setQuery] = useState({ ...DEFAULT_META_INSIGHTS_QUERY })
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState([])
  const [paging, setPaging] = useState(null)
  const [campaignOptions, setCampaignOptions] = useState([])
  const [adsetOptions, setAdsetOptions] = useState([])
  const [adOptions, setAdOptions] = useState([])

  const setQ = (patch) => setQuery((q) => ({ ...q, ...patch }))

  const fmt$ = (v) =>
    v != null ? `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'

  const loadCampaigns = useCallback(async () => {
    if (!actId || !mongoAccountId) return
    try {
      const res = await api.metaCampaigns({ account_id: mongoAccountId, ad_account_id: actId, limit: 100 })
      setCampaignOptions(res?.data || [])
    } catch {
      setCampaignOptions([])
    }
  }, [actId, mongoAccountId])

  useEffect(() => {
    loadCampaigns()
  }, [loadCampaigns])

  useEffect(() => {
    if (!mongoAccountId || (query.scope !== 'adset' && query.scope !== 'ad')) {
      setAdsetOptions([])
      return
    }
    if (!query.scopeCampaignId) {
      setAdsetOptions([])
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.metaAdSets({
          account_id: mongoAccountId,
          campaign_id: query.scopeCampaignId,
          limit: 100,
        })
        if (!cancelled) setAdsetOptions(res?.data || [])
      } catch {
        if (!cancelled) setAdsetOptions([])
      }
    })()
    return () => { cancelled = true }
  }, [mongoAccountId, query.scope, query.scopeCampaignId])

  useEffect(() => {
    if (!mongoAccountId || query.scope !== 'ad') return
    if (!query.scopeAdsetId) {
      setAdOptions([])
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.metaAds({
          account_id: mongoAccountId,
          ad_set_id: query.scopeAdsetId,
          limit: 100,
        })
        if (!cancelled) setAdOptions(res?.data || [])
      } catch {
        if (!cancelled) setAdOptions([])
      }
    })()
    return () => { cancelled = true }
  }, [mongoAccountId, query.scope, query.scopeAdsetId])

  const fetchInsights = useCallback(
    async (afterCursor = null, append = false) => {
      if (!actId || !mongoAccountId) {
        onToast?.('Meta ad account ID missing — reconnect under Accounts', 'error')
        return
      }
      if (query.scope === 'campaign' && !query.scopeCampaignId) {
        onToast?.('Select a campaign', 'error')
        return
      }
      if (query.scope === 'adset' && !query.scopeAdsetId) {
        onToast?.('Select an ad set', 'error')
        return
      }
      if (query.scope === 'ad' && !query.scopeAdId) {
        onToast?.('Select an ad', 'error')
        return
      }
      if (query.timeMode === 'custom' && (!query.since || !query.until)) {
        onToast?.('Custom range requires since and until (YYYY-MM-DD)', 'error')
        return
      }

      setLoading(true)
      try {
        const params = buildMetaInsightsQuery({
          actId,
          query: { ...query, mongoAccountId },
          afterCursor,
        })
        const res = await api.metaInsights(params)
        const data = res?.data || []
        setRows((prev) => (append ? [...prev, ...data] : data))
        setPaging(res?.paging || null)
      } catch (e) {
        onToast?.(e.message, 'error')
        if (!append) {
          setRows([])
          setPaging(null)
        }
      } finally {
        setLoading(false)
      }
    },
    [actId, mongoAccountId, query, onToast],
  )

  const canAutoFetch =
    actId &&
    mongoAccountId &&
    !(query.scope === 'campaign' && !query.scopeCampaignId) &&
    !(query.scope === 'adset' && !query.scopeAdsetId) &&
    !(query.scope === 'ad' && !query.scopeAdId) &&
    !(query.timeMode === 'custom' && (!query.since || !query.until))

  useEffect(() => {
    if (!canAutoFetch) return
    fetchInsights()
  }, [
    canAutoFetch,
    fetchInsights,
    query.timeMode,
    query.timePreset,
    query.since,
    query.until,
    query.scope,
    query.scopeCampaignId,
    query.scopeAdsetId,
    query.scopeAdId,
    query.level,
    query.breakdown,
    query.actionAttribution.join(','),
    query.actionBreakdownsMode,
    query.actionBreakdownsCustom,
    query.compact,
    query.limit,
  ])

  const columns = useMemo(
    () => collectInsightColumns(rows, query.breakdown),
    [rows, query.breakdown],
  )

  const nextAfter = paging?.cursors?.after || paging?.next

  if (!actId) {
    return (
      <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--fg-muted)' }}>
        Meta ad account ID missing on this connection. Reconnect Meta Ads under Accounts.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div className="card" style={{ padding: '1rem 1.25rem' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            marginBottom: '1rem',
            fontWeight: 600,
            fontSize: '0.875rem',
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#1877f2' }} />
          Meta Ads insights
          <span style={{ fontWeight: 400, color: 'var(--fg-muted)', fontSize: '0.75rem' }}>
            (meta_report_insights · {actId})
          </span>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: '0.75rem',
            marginBottom: '0.75rem',
          }}
        >
          <Field label="Report on">
            <select
              className="form-input"
              value={query.scope}
              onChange={(e) => {
                const scope = e.target.value
                setQ({
                  scope,
                  scopeCampaignId: '',
                  scopeAdsetId: '',
                  scopeAdId: '',
                })
              }}
            >
              {META_SCOPE_TYPES.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>

          {query.scope === 'campaign' && (
            <Field label="Campaign">
              <select
                className="form-input"
                value={query.scopeCampaignId}
                onChange={(e) => setQ({ scopeCampaignId: e.target.value, scopeAdsetId: '', scopeAdId: '' })}
              >
                <option value="">Select campaign…</option>
                {campaignOptions.map((c) => (
                  <option key={c.id} value={c.id}>{c.name || c.id}</option>
                ))}
              </select>
            </Field>
          )}

          {query.scope === 'adset' && (
            <>
              <Field label="Campaign">
                <select
                  className="form-input"
                  value={query.scopeCampaignId}
                  onChange={(e) => setQ({ scopeCampaignId: e.target.value, scopeAdsetId: '', scopeAdId: '' })}
                >
                  <option value="">Select campaign…</option>
                  {campaignOptions.map((c) => (
                    <option key={c.id} value={c.id}>{c.name || c.id}</option>
                  ))}
                </select>
              </Field>
              <Field label="Ad set">
                <select
                  className="form-input"
                  value={query.scopeAdsetId}
                  onChange={(e) => setQ({ scopeAdsetId: e.target.value })}
                  disabled={!query.scopeCampaignId}
                >
                  <option value="">Select ad set…</option>
                  {adsetOptions.map((a) => (
                    <option key={a.id} value={a.id}>{a.name || a.id}</option>
                  ))}
                </select>
              </Field>
            </>
          )}

          {query.scope === 'ad' && (
            <>
              <Field label="Campaign">
                <select
                  className="form-input"
                  value={query.scopeCampaignId}
                  onChange={(e) => setQ({ scopeCampaignId: e.target.value, scopeAdsetId: '', scopeAdId: '' })}
                >
                  <option value="">Select campaign…</option>
                  {campaignOptions.map((c) => (
                    <option key={c.id} value={c.id}>{c.name || c.id}</option>
                  ))}
                </select>
              </Field>
              <Field label="Ad set">
                <select
                  className="form-input"
                  value={query.scopeAdsetId}
                  onChange={(e) => setQ({ scopeAdsetId: e.target.value, scopeAdId: '' })}
                  disabled={!query.scopeCampaignId}
                >
                  <option value="">Select ad set…</option>
                  {adsetOptions.map((a) => (
                    <option key={a.id} value={a.id}>{a.name || a.id}</option>
                  ))}
                </select>
              </Field>
              <Field label="Ad">
                <select
                  className="form-input"
                  value={query.scopeAdId}
                  onChange={(e) => setQ({ scopeAdId: e.target.value })}
                  disabled={!query.scopeAdsetId}
                >
                  <option value="">Select ad…</option>
                  {adOptions.map((a) => (
                    <option key={a.id} value={a.id}>{a.name || a.id}</option>
                  ))}
                </select>
              </Field>
            </>
          )}

          <Field
            label="Aggregation level"
            hint={
              query.scope === 'account'
                ? 'Rows grouped at this level under the ad account.'
                : 'Sub-rows under the selected object (e.g. ads within one campaign).'
            }
          >
            <select className="form-input" value={query.level} onChange={(e) => setQ({ level: e.target.value })}>
              {META_INSIGHT_LEVELS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Time">
            <select
              className="form-input"
              value={query.timeMode}
              onChange={(e) => setQ({ timeMode: e.target.value })}
            >
              <option value="preset">Preset</option>
              <option value="custom">Custom dates</option>
            </select>
          </Field>

          {query.timeMode === 'preset' ? (
            <Field label="Preset range">
              <select className="form-input" value={query.timePreset} onChange={(e) => setQ({ timePreset: e.target.value })}>
                {META_TIME_PRESETS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </Field>
          ) : (
            <>
              <Field label="Since">
                <input className="form-input" type="date" value={query.since} onChange={(e) => setQ({ since: e.target.value })} />
              </Field>
              <Field label="Until">
                <input className="form-input" type="date" value={query.until} onChange={(e) => setQ({ until: e.target.value })} />
              </Field>
            </>
          )}

          <Field label="Breakdown">
            <select className="form-input" value={query.breakdown} onChange={(e) => setQ({ breakdown: e.target.value })}>
              {META_BREAKDOWNS.map((b) => (
                <option key={b.value || 'none'} value={b.value}>{b.label}</option>
              ))}
            </select>
          </Field>
        </div>

        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ marginBottom: showAdvanced ? '0.75rem' : 0 }}
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? 'Hide' : 'Show'} advanced options
        </button>

        {showAdvanced && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: '0.75rem',
              marginBottom: '0.75rem',
              padding: '0.75rem',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-subtle, rgba(0,0,0,0.02))',
            }}
          >
            <Field label="Limit (1–500)">
              <input
                className="form-input"
                type="number"
                min={1}
                max={500}
                value={query.limit}
                onChange={(e) => setQ({ limit: Math.min(500, Math.max(1, parseInt(e.target.value, 10) || 100)) })}
              />
            </Field>
            <Field label="API version">
              <input
                className="form-input"
                value={query.apiVersion}
                onChange={(e) => setQ({ apiVersion: e.target.value })}
                placeholder="v22.0"
              />
            </Field>
            <Field label="Compact actions" hint="Removes redundant omni_* / pixel duplicate action types.">
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                <input
                  type="checkbox"
                  checked={query.compact}
                  onChange={(e) => setQ({ compact: e.target.checked })}
                />
                compact=true
              </label>
            </Field>
            <Field label="Action attribution windows">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                {META_ATTRIBUTION_WINDOWS.map((w) => (
                  <label key={w} style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                    <input
                      type="checkbox"
                      checked={query.actionAttribution.includes(w)}
                      onChange={(e) => {
                        setQ({
                          actionAttribution: e.target.checked
                            ? [...query.actionAttribution, w]
                            : query.actionAttribution.filter((x) => x !== w),
                        })
                      }}
                    />
                    {w}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Action breakdowns">
              <select
                className="form-input"
                value={query.actionBreakdownsMode}
                onChange={(e) => setQ({ actionBreakdownsMode: e.target.value })}
              >
                {META_ACTION_BREAKDOWN_MODES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              {query.actionBreakdownsMode === 'custom' && (
                <input
                  className="form-input"
                  style={{ marginTop: '0.35rem' }}
                  value={query.actionBreakdownsCustom}
                  onChange={(e) => setQ({ actionBreakdownsCustom: e.target.value })}
                  placeholder="action_type, action_destination"
                />
              )}
            </Field>
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" disabled={loading || !canAutoFetch} onClick={() => fetchInsights()}>
            {loading ? <span className="spinner" /> : <><RefreshCw size={14} strokeWidth={2} /> Refresh</>}
          </button>
          {nextAfter && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading}
              onClick={() => fetchInsights(nextAfter, true)}
            >
              Load more
            </button>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '1rem 1.25rem', fontWeight: 600, fontSize: '0.875rem', borderBottom: '1px solid var(--border)' }}>
          Results ({rows.length} row{rows.length === 1 ? '' : 's'})
          {paging?.cursors?.after ? ' · more available' : ''}
        </div>
        <div style={{ overflowX: 'auto', maxHeight: 'min(70vh, 720px)' }}>
          <table className="table" style={{ margin: 0, fontSize: '0.8rem' }}>
            <thead>
              <tr>
                {columns.length === 0 ? (
                  <th>Run a report to see columns</th>
                ) : (
                  columns.map((col) => <th key={col.key}>{col.label}</th>)
                )}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={Math.max(columns.length, 1)} style={{ textAlign: 'center', color: 'var(--fg-muted)', padding: '2rem' }}>
                    {loading ? 'Loading…' : 'No rows — adjust filters and run report'}
                  </td>
                </tr>
              ) : (
                rows.map((row, i) => (
                  <tr key={i}>
                    {columns.map((col) => (
                      <td key={col.key} style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }} title={String(row[col.key] ?? '')}>
                        {formatInsightCell(col.key, row[col.key], fmt$)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
