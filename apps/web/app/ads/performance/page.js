'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import AppLayout from '../../../components/AppLayout.js'
import LineChart from '../../../components/LineChart.js'
import { api } from '../../../lib/api.js'
import { useToast } from '../../../components/Toast.js'
import {
  ADS_PERF_PRESETS,
  buildSimpleStatCards,
  defaultDateRange,
  deltaPct,
  fetchAdsPerformance,
  formatBudget,
  formatMoney,
  formatNum,
  formatPct,
  presetById,
} from '../../../lib/adsPerformanceUi.js'
import { TrendingDown, TrendingUp, BarChart3, ArrowLeft } from 'lucide-react'

function DeltaBadge({ pct }) {
  if (pct == null) return null
  const up = pct >= 0
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.15rem',
        fontSize: '0.65rem',
        fontWeight: 700,
        padding: '0.15rem 0.4rem',
        borderRadius: 4,
        background: up ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
        color: up ? '#10b981' : '#ef4444',
        marginLeft: '0.4rem',
        verticalAlign: 'middle',
      }}
    >
      <Icon size={10} strokeWidth={2.5} /> {Math.abs(pct).toFixed(1)}%
    </span>
  )
}

function StatCard({ label, value, raw, prevRaw, prevValue }) {
  const pct = deltaPct(
    typeof raw === 'number' ? raw : null,
    typeof prevRaw === 'number' ? prevRaw : null,
  )
  return (
    <div className="card stat-card">
      <div className="stat-value">
        {value}
        <DeltaBadge pct={pct} />
      </div>
      <div className="stat-label">{label}</div>
      {prevValue != null && prevValue !== value && (
        <div style={{ fontSize: '0.68rem', color: 'var(--fg-muted)', marginTop: '0.1rem' }}>
          prev: {prevValue}
        </div>
      )}
    </div>
  )
}

export default function AdsPerformancePage() {
  return (
    <Suspense
      fallback={
        <AppLayout>
          <div className="skeleton" style={{ height: 200 }} />
        </AppLayout>
      }
    >
      <AdsPerformancePageInner />
    </Suspense>
  )
}

function AdsPerformancePageInner() {
  const searchParams = useSearchParams()
  const toast = useToast()

  const [accounts, setAccounts] = useState([])
  const [accountId, setAccountId] = useState('')
  const [range, setRange] = useState(defaultDateRange)
  const [campaignId, setCampaignId] = useState('')
  const [campaignName, setCampaignName] = useState('')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)

  const selected = accounts.find((a) => a.account_id === accountId)
  const isMeta = selected?.provider === 'meta_ads'

  useEffect(() => {
    api
      .adAccounts()
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : rows?.items || []
        setAccounts(list)
        const fromUrl = searchParams?.get('account')
        if (fromUrl && list.some((a) => a.account_id === fromUrl)) {
          setAccountId(fromUrl)
        } else if (list.length) {
          setAccountId(list[0].account_id)
        }
        const camp = searchParams?.get('campaign')
        if (camp) setCampaignId(camp)
      })
      .catch((e) => toast.error(e.message))
  }, [])

  const load = useCallback(async () => {
    if (!selected) return
    setLoading(true)
    const result = await fetchAdsPerformance({
      connection: selected,
      preset: range.preset,
      from: range.from,
      to: range.to,
      campaignId,
    })
    setData(result)
    if (result.error && result.error.code !== 'needs_customer') {
      toast.error(result.error.message)
    }
    setLoading(false)
  }, [selected, range, campaignId, toast])

  useEffect(() => {
    load()
  }, [load])

  const setPreset = (id) => {
    const p = presetById(id)
    setRange({
      preset: p.id,
      from: formatDateOffset(p.days),
      to: formatToday(),
    })
  }

  const focusCampaign = (row) => {
    setCampaignId(row.id)
    setCampaignName(row.name)
  }

  const clearCampaign = () => {
    setCampaignId('')
    setCampaignName('')
  }

  const totals = data?.totals
  const prev = data?.previousTotals
  const rows = data?.rows || []
  const series = data?.series || []
  const chartReady = series.length > 0 && series.some((s) => (s.spend || 0) + (s.clicks || 0) > 0)
  const provider = selected?.provider || null

  const statCards = useMemo(
    () => buildSimpleStatCards(totals, prev, provider),
    [totals, prev, provider],
  )

  return (
    <AppLayout>
      <div className="page-header-enhanced">
        <div className="page-header-content">
          <div className="page-header-title">
            <div className="page-header-icon">
              <TrendingUp size={18} strokeWidth={2.5} />
            </div>
            <h1 className="page-title">Ads Performance</h1>
          </div>
          <p className="page-header-desc">
            Live metrics for your Google Ads and Meta Ads accounts — account overview, then drill into a campaign.
          </p>
        </div>
        <Link href="/ads/campaigns" className="btn btn-secondary">
          <BarChart3 size={14} strokeWidth={2} /> Campaigns
        </Link>
      </div>

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            className="form-input"
            style={{ minWidth: 260 }}
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value)
              clearCampaign()
            }}
          >
            {accounts.length === 0 && <option value="">No ads accounts connected</option>}
            {accounts.map((a) => (
              <option key={a.account_id} value={a.account_id}>
                {a.ad_account_name || a.account_name} (
                {a.provider === 'google_ads' ? 'Google Ads' : 'Meta Ads'})
              </option>
            ))}
          </select>

          <select
            className="form-input"
            style={{ width: 160 }}
            value={range.preset}
            onChange={(e) => setPreset(e.target.value)}
          >
            {ADS_PERF_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <input
            className="form-input"
            type="date"
            value={range.from}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value, preset: 'custom' }))}
            style={{ width: 150 }}
          />
          <span className="text-muted" style={{ fontSize: '0.875rem' }}>
            to
          </span>
          <input
            className="form-input"
            type="date"
            value={range.to}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value, preset: 'custom' }))}
            style={{ width: 150 }}
          />
        </div>
      </div>

      {accounts.length === 0 ? (
        <div className="empty-state-enhanced">
          <div className="empty-state-icon">
            <TrendingUp size={28} strokeWidth={2} />
          </div>
          <h2 className="empty-state-title">Connect an ads account</h2>
          <p className="empty-state-desc">
            Link Google Ads or Meta Ads under Accounts to see live performance.
          </p>
          <Link href="/accounts" className="btn btn-primary">
            Go to Accounts
          </Link>
        </div>
      ) : data?.error?.code === 'needs_customer' ? (
        <div className="empty-state-enhanced">
          <h2 className="empty-state-title">Account not ready</h2>
          <p className="empty-state-desc">{data.error.message}</p>
          <Link href="/accounts" className="btn btn-primary">
            Open Accounts
          </Link>
        </div>
      ) : (
        <>
          {campaignId && (
            <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={clearCampaign}>
                <ArrowLeft size={14} /> Back to account
              </button>
              <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                {campaignName || `Campaign ${campaignId}`}
              </span>
            </div>
          )}

          {loading ? (
            <>
              <div className="grid-4" style={{ marginBottom: '1.25rem' }}>
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="skeleton" style={{ height: 88, borderRadius: 8 }} />
                ))}
              </div>
              <div className="skeleton" style={{ height: 220, marginBottom: '1.25rem', borderRadius: 8 }} />
              <div className="skeleton" style={{ height: 200, borderRadius: 8 }} />
            </>
          ) : (
            <>
              <div className="grid-4" style={{ marginBottom: '1.25rem' }}>
                {statCards.map((c) => (
                  <StatCard
                    key={c.key || c.label}
                    label={c.label}
                    value={c.value}
                    raw={c.raw}
                    prevRaw={c.prevRaw}
                    prevValue={c.prevValue}
                  />
                ))}
              </div>

              {chartReady && (
                <div style={{ marginBottom: '1.25rem' }}>
                  <LineChart
                    data={series}
                    xKey="date"
                    series={[
                      { key: 'spend', label: 'Spend', color: 'hsl(var(--primary))' },
                      { key: 'clicks', label: 'Clicks', color: 'hsl(var(--accent))' },
                    ]}
                  />
                </div>
              )}

              <div className="card">
                <div className="card-title" style={{ marginBottom: '0.75rem' }}>
                  {campaignId ? 'Ad sets / child rows' : 'Campaigns'}
                </div>
                {rows.length === 0 ? (
                  <p className="text-muted" style={{ margin: 0, fontSize: '0.875rem' }}>
                    No campaign metrics for this period.
                  </p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="table" style={{ margin: 0 }}>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Status</th>
                          <th>Budget</th>
                          <th>Spend</th>
                          <th>Impr.</th>
                          <th>Clicks</th>
                          <th>CTR</th>
                          <th>CPC</th>
                          <th>Conv.</th>
                          <th>CPA</th>
                          <th>ROAS</th>
                          {isMeta && !campaignId && <th>Reach</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr
                            key={r.id || r.name}
                            style={{ cursor: campaignId ? 'default' : 'pointer' }}
                            onClick={() => {
                              if (!campaignId && r.id) focusCampaign(r)
                            }}
                          >
                            <td style={{ fontWeight: 500 }}>{r.name}</td>
                            <td style={{ textTransform: 'capitalize' }}>{r.status}</td>
                            <td>{formatBudget(r.budget, r.budget_type)}</td>
                            <td>{r.spend != null ? formatMoney(r.spend) : '—'}</td>
                            <td>{r.impressions != null ? formatNum(r.impressions) : '—'}</td>
                            <td>{r.clicks != null ? formatNum(r.clicks) : '—'}</td>
                            <td>{r.ctr != null ? formatPct(r.ctr) : '—'}</td>
                            <td>{r.cpc != null ? formatMoney(r.cpc) : '—'}</td>
                            <td>{r.conversions != null ? formatNum(r.conversions) : '—'}</td>
                            <td>{r.cpa != null ? formatMoney(r.cpa) : '—'}</td>
                            <td>{r.roas != null ? `${Number(r.roas).toFixed(2)}x` : '—'}</td>
                            {isMeta && !campaignId && (
                              <td>{r.reach != null ? formatNum(r.reach) : '—'}</td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </AppLayout>
  )
}

function formatToday() {
  const d = new Date()
  return d.toISOString().slice(0, 10)
}

function formatDateOffset(days) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}
