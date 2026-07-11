'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import AppLayout from '../../components/AppLayout.js'
import LineChart from '../../components/LineChart.js'
import { api } from '../../lib/api.js'
import { useToast } from '../../components/Toast.js'
import {
  DollarSign, MousePointerClick, TrendingUp, BarChart3, Target, Users, Calculator, Percent,
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
  const [leads, setLeads] = useState({ total: 0 })
  const [loading, setLoading] = useState(true)
  const [pdfLoading, setPdfLoading] = useState(false)
  const toast = useToast()

  useEffect(() => {
    Promise.all([
      api.budgetSummary().catch(() => null),
      api.campaigns({ per_page: 100 }).catch(() => ({ items: [] })),
      api.leads({ per_page: 1 }).catch(() => ({ total: 0 })),
    ]).then(([s, c, l]) => {
      setSummary(s)
      setCampaigns(c.items || [])
      setLeads(l)
    }).catch(e => toast.error(e.message)).finally(() => setLoading(false))
  }, [])

  const fmt$ = (v) => v != null ? `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
  const fmtPct = (v) => v != null ? `${Number(v).toFixed(2)}%` : '—'

  // Build per-platform spend chart data — Google Ads, Meta Ads
  const spendByPlatform = summary?.by_platform || {}
  const SUPPORTED = new Set(['google_ads', 'meta_ads', 'meta', 'facebook'])
  const platformEntries = Object.entries(spendByPlatform).filter(([p]) => SUPPORTED.has(p))

  // Per-campaign KPI table — paid ads platforms
  const campaignRows = campaigns.filter(c => SUPPORTED.has(c.platform)).map(c => {
    const m = c.metrics || {}
    const ctr = m.impressions > 0 ? ((m.clicks / m.impressions) * 100).toFixed(2) : null
    const cpc = m.clicks > 0 ? (m.spend / m.clicks).toFixed(2) : null
    const cpa = m.conversions > 0 ? (m.spend / m.conversions).toFixed(2) : null
    const roas = m.roas > 0
      ? Number(m.roas).toFixed(2)
      : (m.conversion_value > 0 && m.spend > 0 ? (m.conversion_value / m.spend).toFixed(2) : null)
    const budgetUsed = c.budget?.amount > 0 ? ((m.spend / c.budget.amount) * 100).toFixed(0) : null
    return { ...c, ctr, cpc, cpa, roas, budgetUsed }
  })

  async function downloadPdf() {
    setPdfLoading(true)
    try {
      const blob = await api.downloadKpiReportPdf({ days: 7 })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'kpi-report-7d.pdf'
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
            <h1 className="page-title">Budget & KPIs</h1>
          </div>
          <p className="page-header-desc">Track your advertising spend and metrics</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '1rem' }}>
            {[1,2,3,4].map(i => <div key={i} className="skeleton" style={{ height: 90 }} />)}
          </div>
          <div className="skeleton" style={{ height: 200 }} />
        </div>
      ) : !summary ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--fg-muted)' }}>
          No campaign data yet.{' '}
          <Link href="/ads/campaigns" style={{ color: 'var(--primary)' }}>Create a campaign</Link> to start tracking budget & KPIs.
        </div>
      ) : (
        <>
           {/* Top KPIs */}
          <div className="grid-4" style={{ marginBottom: '1.25rem' }}>
            <KpiCard label="Impressions" value={(summary.total_impressions || 0).toLocaleString()} icon={BarChart3} />
            <KpiCard label="Clicks" value={(summary.total_clicks || 0).toLocaleString()} icon={MousePointerClick} />
            <KpiCard label="CTR" value={fmtPct(summary.ctr)} sub="click-through rate" icon={Percent} />
            <KpiCard label="CPC" value={summary.cpc ? fmt$(summary.cpc) : '—'} sub="cost per click" icon={DollarSign} />
          </div>

          <div className="grid-4" style={{ marginBottom: '1.5rem' }}>
            <KpiCard label="Conversions" value={(summary.total_conversions || 0).toLocaleString()} icon={TrendingUp} />
            <KpiCard label="CPA" value={summary.cpa ? fmt$(summary.cpa) : '—'} sub="cost per acquisition" icon={DollarSign} />
            <KpiCard
              label="ROAS"
              value={summary.portfolio_roas > 0 ? `${Number(summary.portfolio_roas).toFixed(2)}x` : '—'}
              sub="revenue / ad spend"
              icon={TrendingUp}
            />
            <KpiCard label="Active Campaigns" value={summary.active_campaigns} icon={Target} />
          </div>

          <div className="grid-4" style={{ marginBottom: '1.5rem' }}>
            <KpiCard label="Total Campaigns" value={summary.campaign_count} icon={BarChart3} />
            <KpiCard label="Total Leads" value={(leads.total || 0).toLocaleString()} icon={Users} />
            <KpiCard label="Budget Used" value={fmt$(summary.total_spend)} sub={`of ${fmt$(summary.total_budget)}`} icon={DollarSign} />
            <KpiCard label="Budget Left" value={fmt$(summary.budget_remaining)} icon={DollarSign} />
          </div>

          {/* Budget by platform */}
          {platformEntries.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
              <div className="card">
                <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '1.25rem' }}>Budget by Platform</div>
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

              <div className="card">
                <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '1rem' }}>Platform Breakdown</div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="table" style={{ margin: 0 }}>
                    <thead>
                      <tr>
                        <th>Platform</th>
                        <th>Budget</th>
                        <th>Spend</th>
                        <th>Clicks</th>
                        <th>CTR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {platformEntries.map(([platform, d]) => {
                        const ctr = d.impressions > 0 ? ((d.clicks / d.impressions) * 100).toFixed(1) : '—'
                        return (
                          <tr key={platform}>
                            <td style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              <span style={{ width: 8, height: 8, borderRadius: '50%', background: PLATFORM_COLOR[platform] || '#64748b' }} />
                              {PLATFORM_LABEL[platform] || platform}
                            </td>
                            <td>${(d.budget || 0).toLocaleString()}</td>
                            <td>${(d.spend || 0).toLocaleString()}</td>
                            <td>{(d.clicks || 0).toLocaleString()}</td>
                            <td>{ctr}{ctr !== '—' ? '%' : ''}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Per-campaign KPI table */}
          {campaignRows.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '1rem 1.25rem', fontWeight: 600, fontSize: '0.875rem', borderBottom: '1px solid var(--border)' }}>
                Campaign KPIs
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
                      <th>Impressions</th>
                      <th>Clicks</th>
                      <th>CTR</th>
                      <th>CPC</th>
                      <th>Conv.</th>
                      <th>CPA</th>
                      <th>ROAS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaignRows.map(c => (
                      <tr key={c.id}>
                        <td style={{ fontWeight: 500, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</td>
                        <td>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem' }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: PLATFORM_COLOR[c.platform] || '#64748b' }} />
                            {PLATFORM_LABEL[c.platform] || c.platform}
                          </span>
                        </td>
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
                        <td>{(c.metrics?.impressions || 0).toLocaleString()}</td>
                        <td>{(c.metrics?.clicks || 0).toLocaleString()}</td>
                        <td>{c.ctr != null ? `${c.ctr}%` : '—'}</td>
                        <td>{c.cpc != null ? `$${c.cpc}` : '—'}</td>
                        <td>{(c.metrics?.conversions || 0).toLocaleString()}</td>
                        <td>{c.cpa != null ? `$${c.cpa}` : '—'}</td>
                        <td>{c.roas != null ? `${c.roas}x` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={{ marginTop: '1.5rem' }}>
            <AdsOptimizationPanel />
          </div>
        </>
      )}
    </AppLayout>
  )
}
