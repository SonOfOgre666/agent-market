'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import AppLayout from '../../components/AppLayout.js'
import LineChart from '../../components/LineChart.js'
import { api } from '../../lib/api.js'
import { useToast } from '../../components/Toast.js'
import {
  DollarSign, TrendingUp, BarChart3, Target, Calculator,
} from 'lucide-react'
import AdsOptimizationPanel from '../../components/ads/AdsOptimizationPanel.js'

const PLATFORM_LABEL = {
  google_ads: 'Google Ads',
  meta: 'Meta Ads',
  facebook: 'Meta Ads',
  meta_ads: 'Meta Ads',
}
const PLATFORM_COLOR = {
  google_ads: '#4285f4',
  meta: '#1877f2',
  facebook: '#1877f2',
  meta_ads: '#1877f2',
}

const DAY_PRESETS = [
  { id: 7, label: 'Last 7 days' },
  { id: 30, label: 'Last 30 days' },
  { id: 90, label: 'Last 90 days' },
]

function KpiCard({ label, value, sub, color, icon: Icon }) {
  return (
    <div className="card stat-card">
      <div className="stat-with-icon">
        {Icon && (
          <div className="stat-icon" style={{ background: (color || 'var(--primary)') + '15' }}>
            <Icon size={18} color={color || 'hsl(var(--primary))'} strokeWidth={2} />
          </div>
        )}
        <div>
          <div className="stat-value" style={color ? { color } : {}}>{value}</div>
          <div className="stat-label">{label}</div>
        </div>
      </div>
      {sub && <div style={{ fontSize: '0.7rem', color: 'var(--fg-muted)', marginTop: '0.15rem' }}>{sub}</div>}
    </div>
  )
}

function BudgetBar({ label, color, spend, budget }) {
  const pct = budget > 0 ? Math.min(100, (spend / budget) * 100) : 0
  const overBudget = spend > budget && budget > 0
  return (
    <div style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.375rem', fontSize: '0.8rem' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block' }} />
          {label}
        </span>
        <span style={{ color: overBudget ? '#ef4444' : 'var(--fg-muted)' }}>
          ${spend.toLocaleString()} / ${budget.toLocaleString()}
        </span>
      </div>
      <div style={{ height: 8, background: 'var(--surface-2)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: overBudget ? '#ef4444' : color, borderRadius: 4, transition: 'width 0.4s ease' }} />
      </div>
    </div>
  )
}

export default function BudgetPage() {
  const [summary, setSummary] = useState(null)
  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [days, setDays] = useState(7)
  const toast = useToast()

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.budgetSummary().catch(() => null),
      api.campaigns({ per_page: 100 }).catch(() => ({ items: [] })),
    ]).then(([s, c]) => {
      setSummary(s)
      setCampaigns(c.items || [])
    }).catch(e => toast.error(e.message)).finally(() => setLoading(false))
  }, [])

  const fmt$ = (v) => v != null ? `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
  const fmtPct = (v) => v != null ? `${Number(v).toFixed(2)}%` : '—'

  const spendByPlatform = summary?.by_platform || {}
  const SUPPORTED = new Set(['google_ads', 'meta_ads', 'meta', 'facebook'])
  const platformEntries = Object.entries(spendByPlatform).filter(([p]) => SUPPORTED.has(p))

  const pacingPct = summary?.total_budget > 0
    ? Math.min(100, ((summary.total_spend || 0) / summary.total_budget) * 100)
    : null

  const campaignRows = campaigns.filter(c => SUPPORTED.has(c.platform)).map(c => {
    const m = c.metrics || {}
    const budgetUsed = c.budget?.amount > 0 ? ((m.spend / c.budget.amount) * 100).toFixed(0) : null
    return { ...c, budgetUsed }
  }).sort((a, b) => (b.metrics?.spend || 0) - (a.metrics?.spend || 0))

  const chartData = useMemo(() => {
    if (!platformEntries.length) return []
    return platformEntries.map(([platform, d]) => ({
      date: PLATFORM_LABEL[platform] || platform,
      spend: d.spend || 0,
      budget: d.budget || 0,
    }))
  }, [platformEntries])

  async function downloadPdf() {
    setPdfLoading(true)
    try {
      const blob = await api.downloadKpiReportPdf({ days })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `kpi-report-${days}d.pdf`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('KPI report downloaded')
    } catch (err) {
      toast.error(err.message || 'PDF download failed')
    } finally {
      setPdfLoading(false)
    }
  }

  return (
    <AppLayout>
      <div className="page-header-enhanced">
        <div className="page-header-content">
          <div className="page-header-title">
            <div className="page-header-icon">
              <Calculator size={18} strokeWidth={2.5} />
            </div>
            <h1 className="page-title">Budget & pacing</h1>
          </div>
          <p className="page-header-desc">
            See planned budget vs spend, then recommend pacing or reallocation before applying changes.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <select
            className="form-input"
            style={{ width: 150 }}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {DAY_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <button type="button" className="btn btn-secondary" onClick={downloadPdf} disabled={pdfLoading || !summary}>
            {pdfLoading ? 'Generating…' : 'Download PDF'}
          </button>
          <Link href="/ads/performance" className="btn btn-secondary">
            <TrendingUp size={14} strokeWidth={2} /> Live Performance
          </Link>
          <Link href="/ads/campaigns" className="btn btn-primary">
            <BarChart3 size={14} strokeWidth={2} /> Manage Campaigns
          </Link>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="grid-3">
            {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 90 }} />)}
          </div>
          <div className="skeleton" style={{ height: 200 }} />
        </div>
      ) : !summary ? (
        <div className="empty-state-enhanced">
          <h2 className="empty-state-title">No budget data yet</h2>
          <p className="empty-state-desc">Create a campaign to start tracking spend vs budget.</p>
          <Link href="/ads/campaigns" className="btn btn-primary">Create a campaign</Link>
        </div>
      ) : (
        <>
          <div className="grid-3" style={{ marginBottom: '1.25rem' }}>
            <KpiCard label="Total budget" value={fmt$(summary.total_budget)} icon={DollarSign} color="var(--info)" />
            <KpiCard
              label="Spend"
              value={fmt$(summary.total_spend)}
              sub={pacingPct != null ? `${pacingPct.toFixed(0)}% of budget used` : undefined}
              icon={DollarSign}
              color="var(--warning)"
            />
            <KpiCard label="Budget left" value={fmt$(summary.budget_remaining)} icon={DollarSign} color="var(--success)" />
            <KpiCard label="CPA" value={summary.cpa ? fmt$(summary.cpa) : '—'} sub="cost per acquisition" icon={DollarSign} />
            <KpiCard
              label="ROAS"
              value={summary.portfolio_roas > 0 ? `${Number(summary.portfolio_roas).toFixed(2)}x` : '—'}
              sub="revenue / ad spend"
              icon={TrendingUp}
            />
            <KpiCard label="Active campaigns" value={summary.active_campaigns} icon={Target} />
          </div>

          {chartData.length > 0 && (
            <div style={{ marginBottom: '1.25rem' }}>
              <LineChart
                data={chartData}
                xKey="date"
                series={[
                  { key: 'spend', label: 'Spend', color: 'hsl(var(--warning))' },
                  { key: 'budget', label: 'Budget', color: 'hsl(var(--info))' },
                ]}
              />
            </div>
          )}

          {platformEntries.length > 0 && (
            <div className="card" style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '1.25rem' }}>Spend vs budget by platform</div>
              {platformEntries.map(([platform, data]) => (
                <BudgetBar
                  key={platform}
                  label={PLATFORM_LABEL[platform] || platform}
                  color={PLATFORM_COLOR[platform] || '#6366f1'}
                  spend={data.spend}
                  budget={data.budget}
                />
              ))}
            </div>
          )}

          {campaignRows.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: '1.5rem' }}>
              <div style={{ padding: '1rem 1.25rem', fontWeight: 600, fontSize: '0.875rem', borderBottom: '1px solid var(--border)' }}>
                Campaign budget utilization
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ margin: 0 }}>
                  <thead>
                    <tr>
                      <th>Campaign</th>
                      <th>Platform</th>
                      <th>Status</th>
                      <th>Budget</th>
                      <th>Spend</th>
                      <th>Used</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaignRows.map(c => (
                      <tr key={c.id}>
                        <td style={{ fontWeight: 500, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</td>
                        <td style={{ fontSize: '0.8rem' }}>{PLATFORM_LABEL[c.platform] || c.platform}</td>
                        <td>
                          <span style={{ fontSize: '0.75rem', fontWeight: 500, color: { draft: '#64748b', active: '#10b981', paused: '#f59e0b', ended: '#ef4444' }[c.status] }}>
                            {c.status}
                          </span>
                        </td>
                        <td>${(c.budget?.amount || 0).toLocaleString()}</td>
                        <td>${(c.metrics?.spend || 0).toLocaleString()}</td>
                        <td style={{ color: c.budgetUsed > 90 ? '#ef4444' : c.budgetUsed > 70 ? '#f59e0b' : 'var(--fg)' }}>
                          {c.budgetUsed != null ? `${c.budgetUsed}%` : '—'}
                        </td>
                        <td>
                          <Link
                            href={`/ads/performance?account=${encodeURIComponent(c.account_id || '')}&campaign=${encodeURIComponent(c.platform_campaign_id || '')}`}
                            className="btn btn-ghost btn-sm"
                          >
                            Performance
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <AdsOptimizationPanel />
        </>
      )}
    </AppLayout>
  )
}
