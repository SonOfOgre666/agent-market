'use client'
import { useEffect, useState } from 'react'
import AppLayout from '../../components/AppLayout.js'
import LineChart from '../../components/LineChart.js'
import { api } from '../../lib/api.js'
import { useToast } from '../../components/Toast.js'
import { format, subDays } from 'date-fns'

function delta(current, previous) {
  if (previous == null || previous === 0) return null
  return ((current - previous) / previous) * 100
}

function DeltaBadge({ pct }) {
  if (pct == null) return null
  const up = pct >= 0
  return (
    <span style={{
      display: 'inline-block',
      fontSize: '0.65rem',
      fontWeight: 700,
      padding: '0.15rem 0.4rem',
      borderRadius: 4,
      background: up ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
      color: up ? '#10b981' : '#ef4444',
      marginLeft: '0.4rem',
      verticalAlign: 'middle',
    }}>
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
    </span>
  )
}

function StatCard({ label, value, sub, prevValue }) {
  const pct = delta(value, prevValue)
  return (
    <div className="card stat-card">
      <div className="stat-value">
        {typeof value === 'number' ? value.toLocaleString() : value}
        <DeltaBadge pct={pct} />
      </div>
      <div className="stat-label">{label}</div>
      {sub && <div style={{ fontSize: '0.7rem', color: 'var(--fg-muted)', marginTop: '0.15rem' }}>{sub}</div>}
      {prevValue != null && prevValue !== value && (
        <div style={{ fontSize: '0.68rem', color: 'var(--fg-muted)', marginTop: '0.1rem' }}>
          prev: {typeof prevValue === 'number' ? prevValue.toLocaleString() : prevValue}
        </div>
      )}
    </div>
  )
}

export default function ReportsPage() {
  const [accounts, setAccounts] = useState([])
  const [selectedAccount, setSelectedAccount] = useState('')
  const [from, setFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'))
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  useEffect(() => {
    api.accounts().then(accs => {
      setAccounts(accs)
      if (accs.length) setSelectedAccount(accs[0].id)
    }).catch(e => toast.error(e.message))
  }, [])

  useEffect(() => {
    if (!selectedAccount) return
    setLoading(true)
    api.reports({ account_id: selectedAccount, from, to })
      .then(setData)
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false))
  }, [selectedAccount, from, to])

  const metricsChart = (data?.metrics || []).map(m => ({
    date: m.date,
    impressions: m.data?.impressions ?? 0,
    engagements: m.data?.engagements ?? 0,
    likes: m.data?.likes ?? 0,
    shares: m.data?.shares ?? 0,
    comments: m.data?.comments ?? 0,
    clicks: m.data?.clicks ?? 0,
  }))

  const audienceChart = (data?.audience || []).map(a => ({
    date: a.date,
    followers: a.total ?? 0,
  }))

  const totalMetric = (key) => metricsChart.reduce((s, d) => s + (d[key] || 0), 0)
  const prevTotalMetric = (key) => data?.previous_totals?.[key] ?? null

  const latestFollowers = audienceChart.length ? audienceChart[audienceChart.length - 1].followers : 0
  const followerDelta = audienceChart.length > 1
    ? audienceChart[audienceChart.length - 1].followers - audienceChart[0].followers
    : null

  const hasEngagements = metricsChart.some(d => d.engagements || d.likes || d.comments || d.shares)
  const hasClicks = metricsChart.some(d => d.clicks)

  return (
    <AppLayout>
      <div className="page-header">
        <h1 className="page-title">Reports</h1>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            className="form-input"
            style={{ width: 220 }}
            value={selectedAccount}
            onChange={e => setSelectedAccount(e.target.value)}
          >
            {accounts.length === 0 && <option value="">No accounts connected</option>}
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.name} ({a.provider})</option>
            ))}
          </select>
          <input className="form-input" type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ width: 160 }} />
          <span className="text-muted" style={{ fontSize: '0.875rem' }}>to</span>
          <input className="form-input" type="date" value={to} onChange={e => setTo(e.target.value)} style={{ width: 160 }} />
          {data?.previous_totals && (
            <span style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginLeft: 'auto' }}>
              ▲▼ vs previous period
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
            {[1,2,3,4].map(i => <div key={i} className="skeleton" style={{ height: 100, borderRadius: 12 }} />)}
          </div>
          <div className="skeleton" style={{ height: 260, borderRadius: 12 }} />
          <div className="skeleton" style={{ height: 220, borderRadius: 12 }} />
        </div>
      ) : !data ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--fg-muted)' }}>
          {accounts.length === 0
            ? 'Connect a social account first to see analytics.'
            : 'No data found for the selected period.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Summary stats with period comparison */}
          <div className="grid-4">
            <StatCard
              label="Impressions"
              value={totalMetric('impressions')}
              prevValue={prevTotalMetric('impressions')}
            />
            <StatCard
              label="Engagements"
              value={totalMetric('engagements')}
              prevValue={prevTotalMetric('engagements')}
            />
            <StatCard
              label="Likes"
              value={totalMetric('likes')}
              prevValue={prevTotalMetric('likes')}
            />
            <StatCard
              label="Followers"
              value={latestFollowers}
              prevValue={data.previous_followers}
              sub={followerDelta !== null
                ? `${followerDelta >= 0 ? '+' : ''}${followerDelta.toLocaleString()} over period`
                : undefined}
            />
          </div>

          <div className="grid-4">
            <StatCard
              label="Clicks"
              value={totalMetric('clicks')}
              prevValue={prevTotalMetric('clicks')}
            />
            <StatCard
              label="Shares"
              value={totalMetric('shares')}
              prevValue={prevTotalMetric('shares')}
            />
            <StatCard
              label="Comments"
              value={totalMetric('comments')}
              prevValue={prevTotalMetric('comments')}
            />
            <StatCard
              label="Reach"
              value={totalMetric('reach') || totalMetric('impressions')}
              prevValue={prevTotalMetric('reach') || prevTotalMetric('impressions')}
            />
          </div>

          {/* Impressions chart */}
          <LineChart
            title="Impressions"
            data={metricsChart}
            series={[{ key: 'impressions', label: 'Impressions', color: '#6366f1' }]}
            height={220}
          />

          {/* Engagement breakdown */}
          {hasEngagements && (
            <LineChart
              title="Engagements"
              data={metricsChart}
              series={[
                { key: 'engagements', label: 'Total', color: '#22d3ee' },
                { key: 'likes', label: 'Likes', color: '#f59e0b' },
                { key: 'comments', label: 'Comments', color: '#10b981' },
                { key: 'shares', label: 'Shares', color: '#f43f5e' },
              ]}
              height={220}
            />
          )}

          {/* Clicks */}
          {hasClicks && (
            <LineChart
              title="Link Clicks"
              data={metricsChart}
              series={[{ key: 'clicks', label: 'Clicks', color: '#10b981' }]}
              height={180}
            />
          )}

          {/* Audience growth */}
          {audienceChart.length > 0 && (
            <LineChart
              title="Audience Growth"
              data={audienceChart}
              series={[{ key: 'followers', label: 'Followers', color: '#a78bfa' }]}
              height={200}
            />
          )}

          {/* Facebook page insights table */}
          {data.facebook_insights?.length > 0 && (
            <div className="card">
              <div style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem' }}>Facebook Page Insights</div>
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      {Object.keys(data.facebook_insights[0]?.data || {}).map(k => (
                        <th key={k} style={{ textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.facebook_insights.slice(-14).map((row, i) => (
                      <tr key={i}>
                        <td>{row.date}</td>
                        {Object.values(row.data || {}).map((v, j) => (
                          <td key={j}>{typeof v === 'number' ? v.toLocaleString() : v}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      )}
    </AppLayout>
  )
}
