'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api.js'
import {
  GOOGLE_DATE_RANGES,
  GOOGLE_REPORT_VIEWS,
  DEFAULT_GOOGLE_INSIGHTS_QUERY,
  buildGoogleReportParams,
  columnsForGoogleView,
  formatGoogleCell,
  normalizeGoogleReportRows,
  summaryFromAccountResponse,
} from '../../lib/googleInsightsUi.js'
import Link from 'next/link'
import {
  listGoogleCampaigns,
  optimizeGoogleGeoTargeting,
  suggestGoogleNegativeKeywords,
} from '../../lib/googleAdsTools.js'
import { Lightbulb, RefreshCw, Wrench } from 'lucide-react'

const GOOGLE_COLOR = '#4285f4'

const HINT_ACTION_LABEL = {
  review_pause: 'Review / pause',
  reduce_budget: 'Reduce budget',
  improve_creative: 'Improve creative',
}

function StatCard({ label, value, sub }) {
  return (
    <div className="card stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && (
        <div style={{ fontSize: '0.7rem', color: 'var(--fg-muted)', marginTop: '0.15rem' }}>{sub}</div>
      )}
    </div>
  )
}

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
 * Google Ads reporting explorer — uses GET /ads/google/* (worker google_report_* tools).
 */
export default function GoogleInsightsPanel({ connection, onToast }) {
  const mongoAccountId = connection?.account_id
  const customerReady = connection?.ad_account_id && !connection?.needs_reconnect

  const [query, setQuery] = useState({ ...DEFAULT_GOOGLE_INSIGHTS_QUERY })
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState([])
  const [summary, setSummary] = useState(null)
  const [hints, setHints] = useState([])
  const [loadError, setLoadError] = useState(null)
  const [campaignOptions, setCampaignOptions] = useState([])
  const [actionBusy, setActionBusy] = useState(null)

  const viewMeta = useMemo(
    () => GOOGLE_REPORT_VIEWS.find((v) => v.id === query.view) || GOOGLE_REPORT_VIEWS[0],
    [query.view],
  )
  const columns = useMemo(() => columnsForGoogleView(query.view), [query.view])

  const setQ = (patch) => setQuery((q) => ({ ...q, ...patch }))

  const fmt$ = (v) =>
    v != null
      ? `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : '—'

  const loadCampaigns = useCallback(async () => {
    if (!mongoAccountId || !customerReady) return
    try {
      const list = await listGoogleCampaigns(mongoAccountId, { limit: 100 })
      setCampaignOptions(
        (list || []).map((c) => ({
          id: c.google_campaign_id || c.platform_campaign_id || c.id,
          name: c.name || c.campaign_name,
        })),
      )
    } catch {
      setCampaignOptions([])
    }
  }, [mongoAccountId, customerReady])

  useEffect(() => {
    loadCampaigns()
  }, [loadCampaigns])

  const runReport = useCallback(async () => {
    if (!mongoAccountId || !customerReady) return
    setLoading(true)
    setLoadError(null)
    setRows([])
    setSummary(null)
    setHints([])

    const params = buildGoogleReportParams(query, mongoAccountId)
    const apiFn = api[viewMeta.api]
    if (!apiFn) {
      setLoadError(`Unknown report view: ${viewMeta.id}`)
      setLoading(false)
      return
    }

    try {
      const tasks = [apiFn(params)]
      if (query.view === 'performance') {
        tasks.push(api.googleAccountSummary(params))
        tasks.push(api.adsOptimizationHints(mongoAccountId, { date_range: query.dateRange }))
      }
      const results = await Promise.allSettled(tasks)
      const main = results[0]
      if (main.status === 'fulfilled') {
        setRows(normalizeGoogleReportRows(query.view, main.value))
        if (query.view === 'account_summary') {
          setSummary(summaryFromAccountResponse(main.value))
        }
      } else {
        throw new Error(main.reason?.message || 'Report failed')
      }

      if (query.view === 'performance' && results[1]?.status === 'fulfilled') {
        setSummary(summaryFromAccountResponse(results[1].value))
      }
      if (query.view === 'performance' && results[2]?.status === 'fulfilled') {
        const hintPayload = results[2].value?.payload || results[2].value?.data?.payload
        setHints(hintPayload?.hints || [])
      }
    } catch (e) {
      const msg = e.message || 'Google reporting failed'
      setLoadError(msg)
      onToast?.(msg, 'error')
    } finally {
      setLoading(false)
    }
  }, [mongoAccountId, customerReady, query, viewMeta, onToast])

  useEffect(() => {
    if (mongoAccountId && customerReady) runReport()
  }, [mongoAccountId, customerReady, query.view, query.dateRange, query.campaignId, query.status])

  if (!customerReady) {
    return (
      <div
        className="card"
        style={{
          padding: '1rem',
          borderColor: 'var(--warning, #f59e0b)',
          background: 'rgba(245, 158, 11, 0.08)',
        }}
      >
        <p style={{ margin: 0, fontSize: '0.875rem' }}>
          Connect a Google Ads <strong>customer ID</strong> under Accounts before running reports.
        </p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div className="card">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: '0.75rem',
            alignItems: 'end',
          }}
        >
          <Field label="Report" hint={viewMeta.description}>
            <select
              className="form-input"
              value={query.view}
              onChange={(e) => setQ({ view: e.target.value, campaignId: '' })}
            >
              {GOOGLE_REPORT_VIEWS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date range">
            <select
              className="form-input"
              value={query.dateRange}
              onChange={(e) => setQ({ dateRange: e.target.value })}
            >
              {GOOGLE_DATE_RANGES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
          {viewMeta.needsCampaign && (
            <Field label="Campaign filter" hint="Optional — limits ad groups, keywords, ads">
              <select
                className="form-input"
                value={query.campaignId}
                onChange={(e) => setQ({ campaignId: e.target.value })}
              >
                <option value="">All campaigns</option>
                {campaignOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.id}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div>
            <button type="button" className="btn btn-primary" onClick={runReport} disabled={loading}>
              <RefreshCw size={14} strokeWidth={2} /> Refresh
            </button>
          </div>
        </div>
      </div>

      {loadError && (
        <div
          className="card"
          style={{
            padding: '1rem',
            borderColor: 'var(--danger, #dc2626)',
            background: 'rgba(220, 38, 38, 0.06)',
            fontSize: '0.875rem',
          }}
        >
          <strong>Could not load Google Ads reporting.</strong>
          <p style={{ margin: '0.5rem 0 0', color: 'var(--fg-muted)' }}>{loadError}</p>
        </div>
      )}

      {summary && query.view === 'performance' && (
        <div className="grid-4">
          <StatCard label="Spend" value={fmt$(summary.total_cost ?? summary.spend)} />
          <StatCard
            label="Clicks"
            value={((summary.total_clicks ?? summary.clicks) || 0).toLocaleString()}
          />
          <StatCard
            label="CTR"
            value={
              summary.average_ctr != null
                ? `${Number(summary.average_ctr).toFixed(2)}%`
                : summary.ctr != null
                  ? `${Number(summary.ctr).toFixed(2)}%`
                  : '—'
            }
          />
          <StatCard
            label="Conversions"
            value={((summary.total_conversions ?? summary.conversions) || 0).toLocaleString()}
          />
        </div>
      )}

      {query.view === 'account_summary' && summary && (
        <div className="grid-4">
          <StatCard label="Spend" value={fmt$(summary.total_cost)} />
          <StatCard label="Clicks" value={(summary.total_clicks || 0).toLocaleString()} />
          <StatCard label="Impressions" value={(summary.total_impressions || 0).toLocaleString()} />
          <StatCard label="Conversions" value={(summary.total_conversions || 0).toLocaleString()} />
        </div>
      )}

      {hints.length > 0 && query.view === 'performance' && (
        <div className="card">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontWeight: 600,
              fontSize: '0.875rem',
              marginBottom: '0.75rem',
            }}
          >
            <Lightbulb size={16} color="#f59e0b" strokeWidth={2} />
            Optimization suggestions (read-only — google_report_optimization_hints)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {hints.map((h, i) => (
              <div
                key={i}
                style={{
                  padding: '0.65rem 0.85rem',
                  background: 'var(--surface-2)',
                  borderRadius: 8,
                  borderLeft: `3px solid ${GOOGLE_COLOR}`,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '0.8rem' }}>
                  {h.campaign_name || h.campaign_id} — {HINT_ACTION_LABEL[h.action] || h.action}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginTop: '0.2rem' }}>
                  {h.reason}
                </div>
                {h.campaign_id && mongoAccountId && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.5rem' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={actionBusy === `geo-${i}`}
                      onClick={async () => {
                        setActionBusy(`geo-${i}`)
                        try {
                          const out = await optimizeGoogleGeoTargeting(mongoAccountId, {
                            platformCampaignId: String(h.campaign_id),
                          })
                          onToast?.(
                            `${out.count ?? 0} geo recommendations — open Tool console to apply bids`,
                            'success',
                          )
                        } catch (e) {
                          onToast?.(e.message, 'error')
                        } finally {
                          setActionBusy(null)
                        }
                      }}
                    >
                      Geo recommendations
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={actionBusy === `neg-${i}`}
                      onClick={async () => {
                        setActionBusy(`neg-${i}`)
                        try {
                          const out = await suggestGoogleNegativeKeywords(mongoAccountId, {
                            platformCampaignId: String(h.campaign_id),
                          })
                          onToast?.(
                            `${out.count ?? out.suggestions?.length ?? 0} negative keyword suggestions`,
                            'success',
                          )
                        } catch (e) {
                          onToast?.(e.message, 'error')
                        } finally {
                          setActionBusy(null)
                        }
                      }}
                    >
                      Suggest negatives
                    </button>
                    <Link
                      href={`/ads/campaigns?platform=google_ads&account=${mongoAccountId}&campaign=${h.campaign_id}`}
                      className="btn btn-ghost btn-sm"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    >
                      <Wrench size={12} /> Tools
                    </Link>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {query.view !== 'account_summary' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div
            style={{
              padding: '1rem 1.25rem',
              fontWeight: 600,
              fontSize: '0.875rem',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}
          >
            <span
              style={{ width: 8, height: 8, borderRadius: '50%', background: GOOGLE_COLOR, display: 'inline-block' }}
            />
            {viewMeta.label}
          </div>
          <div style={{ overflowX: 'auto' }}>
            {loading ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--fg-muted)' }}>Loading…</div>
            ) : (
              <table className="table" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    {columns.map((col) => (
                      <th key={col.key}>{col.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length || 1} style={{ textAlign: 'center', color: 'var(--fg-muted)', padding: '2rem' }}>
                        {loadError ? 'See error above' : 'No data for this period'}
                      </td>
                    </tr>
                  ) : (
                    rows.map((row, i) => (
                      <tr key={row.campaign_id || row.ad_group_id || row.keyword || row.ad_id || i}>
                        {columns.map((col) => (
                          <td key={col.key} style={col.key.includes('name') ? { fontWeight: 500 } : undefined}>
                            {formatGoogleCell(row, col)}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
