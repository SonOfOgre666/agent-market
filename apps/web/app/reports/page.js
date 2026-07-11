'use client'
import { useEffect, useMemo, useState } from 'react'
import AppLayout from '../../components/AppLayout.js'
import LineChart from '../../components/LineChart.js'
import { api } from '../../lib/api.js'
import { useToast } from '../../components/Toast.js'
import { useWorkspaceSettings } from '../../components/WorkspaceSettingsProvider.js'
import { PROVIDER_LABEL } from '../../lib/commentUi.js'
import {
  buildMetricsChart,
  chartHasData,
  getReportsConfig,
  reportsHasContent,
  sumMetric,
} from '../../lib/reportsUi.js'
import { format, subDays } from 'date-fns'
import { BarChart3, ExternalLink, Info, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react'

function delta(current, previous) {
  if (previous == null || previous === 0) return null
  return ((current - previous) / previous) * 100
}

function DeltaBadge({ pct }) {
  if (pct == null) return null
  const up = pct >= 0
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <span style={{
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
    }}>
      <Icon size={10} strokeWidth={2.5} /> {Math.abs(pct).toFixed(1)}%
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

function PlatformNotice({ config }) {
  if (!config.limitations?.length && !config.officialOnly?.length) return null
  return (
    <div className="card" style={{ padding: '1rem 1.1rem', background: 'var(--bg-subtle, rgba(99,102,241,0.06))' }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
        <Info size={16} style={{ flexShrink: 0, marginTop: 2, color: 'var(--fg-muted)' }} />
        <div style={{ fontSize: '0.8rem', lineHeight: 1.5 }}>
          <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>
            {config.label} — supported by{' '}
            <a href={config.docsUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              official API <ExternalLink size={12} />
            </a>
          </div>
          {config.limitations?.map((note) => (
            <div key={note} style={{ color: 'var(--fg-muted)' }}>• {note}</div>
          ))}
          {config.officialOnly?.length > 0 && (
            <div style={{ marginTop: '0.5rem', color: 'var(--fg-muted)' }}>
              <span style={{ fontWeight: 600, color: 'var(--fg)' }}>Available via API, not imported yet: </span>
              {config.officialOnly.map((m) => m.label).join(', ')}.
            </div>
          )}
        </div>
      </div>
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
  const [syncing, setSyncing] = useState(false)
  const toast = useToast()
  const { formatDateTime } = useWorkspaceSettings()
  const chartDateLabel = (dateStr) => formatDateTime(`${dateStr}T12:00:00.000Z`, { style: 'date-only' })

  const selected = accounts.find((a) => a.id === selectedAccount)
  const provider = selected?.provider || data?.account?.provider || 'twitter'
  const config = useMemo(() => getReportsConfig(provider), [provider])

  useEffect(() => {
    api.accounts({ kind: 'social' }).then((accs) => {
      setAccounts(accs)
      if (accs.length) setSelectedAccount(accs[0].id)
    }).catch((e) => toast.error(e.message))
  }, [])

  useEffect(() => {
    if (!selectedAccount) return
    setLoading(true)
    api.reports({ account_id: selectedAccount, from, to })
      .then(setData)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false))
  }, [selectedAccount, from, to])

  const refreshReports = () => {
    if (!selectedAccount) return
    setLoading(true)
    api.reports({ account_id: selectedAccount, from, to })
      .then(setData)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false))
  }

  const syncImports = async () => {
    if (!selectedAccount) return
    setSyncing(true)
    try {
      await api.queueAccountImports(selectedAccount)
      toast.success('Import jobs queued — refresh in a minute')
      setTimeout(refreshReports, 45000)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setSyncing(false)
    }
  }

  const metricsChart = useMemo(
    () => (data ? buildMetricsChart(data, provider) : []),
    [data, provider],
  )

  const audienceChart = (data?.audience || []).map((a) => ({
    date: a.date,
    followers: a.total ?? 0,
  }))

  const prevTotal = (key) => data?.previous_totals?.[key] ?? null

  const latestFollowers = audienceChart.length ? audienceChart[audienceChart.length - 1].followers : 0
  const followerDelta = audienceChart.length > 1
    ? audienceChart[audienceChart.length - 1].followers - audienceChart[0].followers
    : null

  const statCards = [
    ...config.statCards.map((card) => ({
      key: card.key,
      label: card.label,
      value: sumMetric(metricsChart, card.key),
      prevValue: prevTotal(card.key),
    })),
    ...(config.audience ? [{
      key: 'followers',
      label: 'Followers',
      value: latestFollowers,
      prevValue: data?.previous_followers,
      sub: followerDelta !== null
        ? `${followerDelta >= 0 ? '+' : ''}${followerDelta.toLocaleString()} over period`
        : undefined,
    }] : []),
  ]

  const visibleCharts = config.charts.filter((chart) =>
    chartHasData(metricsChart, chart.series.map((s) => s.key)),
  )

  const hasContent = data && reportsHasContent(data, provider)

  return (
    <AppLayout>
      <div className="page-header-enhanced">
        <div className="page-header-content">
          <div className="page-header-title">
            <div className="page-header-icon">
              <BarChart3 size={18} strokeWidth={2.5} />
            </div>
            <h1 className="page-title">Reports</h1>
          </div>
          <p className="page-header-desc">
            Platform-specific analytics for {config.label}
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            className="form-input"
            style={{ width: 260 }}
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
          >
            {accounts.length === 0 && <option value="">No accounts connected</option>}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({PROVIDER_LABEL[a.provider] || a.provider})
              </option>
            ))}
          </select>
          <input className="form-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 160 }} />
          <span className="text-muted" style={{ fontSize: '0.875rem' }}>to</span>
          <input className="form-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 160 }} />
          {selectedAccount && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={syncImports}
              disabled={syncing || loading}
              title="Queue follower and metrics import from the platform"
            >
              {syncing ? <span className="spinner" /> : <><RefreshCw size={14} strokeWidth={2} /> Sync</>}
            </button>
          )}
          {data?.previous_totals && (
            <span style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <TrendingUp size={10} strokeWidth={2} /> <TrendingDown size={10} strokeWidth={2} /> vs previous period
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
            {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton" style={{ height: 100, borderRadius: 12 }} />)}
          </div>
          <div className="skeleton" style={{ height: 260, borderRadius: 12 }} />
        </div>
      ) : !data ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--fg-muted)' }}>
          {accounts.length === 0
            ? 'Connect a social account first to see analytics.'
            : 'No data found for the selected period.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <PlatformNotice config={config} />

          {!hasContent ? (
            <div className="card" style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--fg-muted)' }}>
              No imported metrics for this {config.label} account in the selected date range.
              {config.audience && ' Use Sync to pull followers and insights from the platform.'}
            </div>
          ) : (
            <>
              {statCards.length > 0 && (
                <div className="grid-4">
                  {statCards.map((card) => (
                    <StatCard
                      key={card.key}
                      label={card.label}
                      value={card.value}
                      prevValue={card.prevValue}
                      sub={card.sub}
                    />
                  ))}
                </div>
              )}

              {visibleCharts.map((chart) => (
                <LineChart
                  key={chart.title}
                  title={chart.title}
                  data={metricsChart}
                  series={chart.series}
                  height={220}
                  formatDateLabel={chartDateLabel}
                />
              ))}

              {config.audience && audienceChart.length > 0 && (
                <LineChart
                  title="Followers"
                  data={audienceChart}
                  series={[{ key: 'followers', label: 'Followers', color: '#a78bfa' }]}
                  height={200}
                  formatDateLabel={chartDateLabel}
                />
              )}
            </>
          )}
        </div>
      )}
    </AppLayout>
  )
}
