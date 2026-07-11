'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import AppLayout from '../../components/AppLayout.js'
import { api } from '../../lib/api.js'
import { useToast } from '../../components/Toast.js'
import {
  Target, DollarSign, MousePointerClick, TrendingUp, BarChart3,
  RefreshCw, PlusCircle, Layers, Search, Image,
} from 'lucide-react'

const GOOGLE_COLOR = '#4285f4'
const META_COLOR = '#1877f2'

const STATUS_COLOR = { draft: '#64748b', active: '#10b981', paused: '#f59e0b', ended: '#ef4444' }

function PlatformBadge({ platform }) {
  if (platform === 'google_ads') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.7rem', fontWeight: 600, color: GOOGLE_COLOR, background: GOOGLE_COLOR + '15', borderRadius: 4, padding: '0.15rem 0.5rem' }}>
        <Search size={10} strokeWidth={2.5} /> Google Ads
      </span>
    )
  }
  if (platform === 'meta' || platform === 'facebook' || platform === 'meta_ads') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.7rem', fontWeight: 600, color: META_COLOR, background: META_COLOR + '15', borderRadius: 4, padding: '0.15rem 0.5rem' }}>
        <Image size={10} strokeWidth={2.5} /> Meta Ads
      </span>
    )
  }
  return null
}

function MetricCard({ label, value, icon: Icon, color }) {
  return (
    <div className="card stat-card">
      <div className="stat-with-icon">
        <div className="stat-icon" style={{ background: color + '15' }}>
          <Icon size={18} color={color} strokeWidth={2} />
        </div>
        <div>
          <div className="stat-value">{value}</div>
          <div className="stat-label">{label}</div>
        </div>
      </div>
    </div>
  )
}

export default function AdsPage() {
  const [summary, setSummary] = useState(null)
  const [googleCampaigns, setGoogleCampaigns] = useState([])
  const [metaCampaigns, setMetaCampaigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const toast = useToast()

  const load = async () => {
    setLoading(true)
    try {
      const [s, all] = await Promise.all([
        api.budgetSummary().catch(() => null),
        api.campaigns({ per_page: 20 }).catch(() => ({ items: [] })),
      ])
      setSummary(s)
      const items = all.items || []
      setGoogleCampaigns(items.filter(c => c.platform === 'google_ads'))
      setMetaCampaigns(items.filter(c => ['meta', 'facebook', 'meta_ads'].includes(c.platform)))
    } catch (e) { toast.error(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const syncGoogle = async () => {
    setSyncing(true)
    try {
      const res = await api.syncGoogleAdsCampaigns()
      if (res?.queued) {
        toast.success(res.message || 'Sync queued — updating in a few seconds')
        setTimeout(() => load(), 4000)
      } else {
        toast.success('Google Ads synced')
        load()
      }
    } catch (e) { toast.error(e.message) }
    finally { setSyncing(false) }
  }

  const syncMeta = async () => {
    setSyncing(true)
    try {
      const res = await api.syncMetaCampaigns()
      if (res?.queued) {
        toast.success(res.message || 'Sync queued — updating in a few seconds')
        setTimeout(() => load(), 4000)
      } else {
        toast.success('Meta Ads synced')
        load()
      }
    } catch (e) { toast.error(e.message) }
    finally { setSyncing(false) }
  }

  const bp = summary?.by_platform || {}
  const googleSummary = bp['google_ads']
  const metaSummary = bp['meta'] || bp['facebook'] || bp['meta_ads']

  return (
    <AppLayout>
      <div className="page-header-enhanced">
        <div className="page-header-content">
          <div className="page-header-title">
            <div className="page-header-icon">
              <Target size={18} strokeWidth={2.5} />
            </div>
            <h1 className="page-title">Ads & Campaigns</h1>
          </div>
          <p className="page-header-desc">Google Ads & Meta Ads management and performance</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Link href="/ads/performance" className="btn btn-secondary">
            <TrendingUp size={14} strokeWidth={2} /> Performance
          </Link>
          <Link href="/accounts" className="btn btn-secondary">Accounts</Link>
          <Link href="/ads/campaigns" className="btn btn-primary">
            <PlusCircle size={14} strokeWidth={2} /> New Campaign
          </Link>
        </div>
      </div>

      {/* Account-level KPIs */}
      {summary && (
        <div className="grid-4" style={{ marginBottom: '1.5rem' }}>
          <MetricCard label="Total Budget" value={`$${(summary.total_budget || 0).toLocaleString()}`} icon={DollarSign} color="var(--info)" />
          <MetricCard label="Total Spend" value={`$${(summary.total_spend || 0).toLocaleString()}`} icon={DollarSign} color="var(--warning)" />
          <MetricCard label="CTR" value={`${summary.ctr || 0}%`} icon={MousePointerClick} color="var(--primary)" />
          <MetricCard label="Active Campaigns" value={summary.active_campaigns || 0} icon={Target} color="var(--success)" />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>

        {/* Google Ads Panel */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: GOOGLE_COLOR, display: 'inline-block' }} />
              <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Google Ads</span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn btn-ghost btn-sm" onClick={syncGoogle} disabled={syncing}>
                <RefreshCw size={12} strokeWidth={2} /> Sync
              </button>
              <Link href="/ads/campaigns?platform=google_ads" style={{ fontSize: '0.75rem', color: 'var(--primary)' }}>View all</Link>
            </div>
          </div>

          {/* Google platform stats */}
          {googleSummary && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '1rem' }}>
              {[
                { label: 'Spend', value: `$${(googleSummary.spend || 0).toLocaleString()}` },
                { label: 'Clicks', value: (googleSummary.clicks || 0).toLocaleString() },
                { label: 'Conversions', value: (googleSummary.conversions || 0).toLocaleString() },
              ].map(s => (
                <div key={s.label} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '0.5rem 0.75rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{s.value}</div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--fg-muted)', marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {loading ? <div className="skeleton" style={{ height: 100 }} /> : googleCampaigns.length === 0 ? (
            <div style={{ color: 'var(--fg-muted)', fontSize: '0.875rem', textAlign: 'center', padding: '1.5rem 0' }}>
              No Google Ads campaigns.{' '}
              <Link href="/ads/campaigns" style={{ color: GOOGLE_COLOR }}>Create one</Link>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {googleCampaigns.slice(0, 5).map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.4rem 0.5rem', background: 'var(--surface-2)', borderRadius: 6 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--fg-muted)' }}>{c.type || 'search'} · ${(c.budget?.amount || 0).toLocaleString()}/day</div>
                  </div>
                  <span style={{ fontSize: '0.7rem', color: STATUS_COLOR[c.status] || '#64748b', fontWeight: 500 }}>{c.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Meta Ads Panel */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: META_COLOR, display: 'inline-block' }} />
              <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Meta Ads</span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn btn-ghost btn-sm" onClick={syncMeta} disabled={syncing}>
                <RefreshCw size={12} strokeWidth={2} /> Sync
              </button>
              <Link href="/ads/campaigns?platform=meta_ads" style={{ fontSize: '0.75rem', color: 'var(--primary)' }}>View all</Link>
            </div>
          </div>

          {/* Meta platform stats */}
          {metaSummary && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '1rem' }}>
              {[
                { label: 'Spend', value: `$${(metaSummary.spend || 0).toLocaleString()}` },
                { label: 'Reach', value: (metaSummary.impressions || 0).toLocaleString() },
                { label: 'Conversions', value: (metaSummary.conversions || 0).toLocaleString() },
              ].map(s => (
                <div key={s.label} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '0.5rem 0.75rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{s.value}</div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--fg-muted)', marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {loading ? <div className="skeleton" style={{ height: 100 }} /> : metaCampaigns.length === 0 ? (
            <div style={{ color: 'var(--fg-muted)', fontSize: '0.875rem', textAlign: 'center', padding: '1.5rem 0' }}>
              No Meta Ads campaigns.{' '}
              <Link href="/ads/campaigns" style={{ color: META_COLOR }}>Create one</Link>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {metaCampaigns.slice(0, 5).map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.4rem 0.5rem', background: 'var(--surface-2)', borderRadius: 6 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--fg-muted)' }}>{c.objective || 'traffic'} · ${(c.budget?.amount || 0).toLocaleString()}</div>
                  </div>
                  <span style={{ fontSize: '0.7rem', color: STATUS_COLOR[c.status] || '#64748b', fontWeight: 500 }}>{c.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* All campaigns table */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ fontWeight: 600, fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Layers size={14} strokeWidth={2} /> All Campaigns
          </div>
          <Link href="/ads/campaigns" className="btn btn-secondary btn-sm">
            <BarChart3 size={12} strokeWidth={2} /> Manage
          </Link>
        </div>
        {loading ? <div className="skeleton" style={{ height: 200 }} /> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Platform</th>
                  <th>Status</th>
                  <th>Budget</th>
                  <th>Impressions</th>
                  <th>Clicks</th>
                  <th>Spend</th>
                  <th>CTR</th>
                </tr>
              </thead>
              <tbody>
                {[...googleCampaigns, ...metaCampaigns].length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--fg-muted)', padding: '2rem' }}>No campaigns yet</td></tr>
                ) : [...googleCampaigns, ...metaCampaigns].map(c => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 500 }}>{c.name}</td>
                    <td><PlatformBadge platform={c.platform} /></td>
                    <td><span style={{ fontSize: '0.75rem', color: STATUS_COLOR[c.status] || '#64748b', fontWeight: 500 }}>{c.status}</span></td>
                    <td>${(c.budget?.amount || 0).toLocaleString()}</td>
                    <td>{(c.metrics?.impressions || 0).toLocaleString()}</td>
                    <td>{(c.metrics?.clicks || 0).toLocaleString()}</td>
                    <td>${(c.metrics?.spend || 0).toLocaleString()}</td>
                    <td>{c.metrics?.ctr ? `${(c.metrics.ctr * 100).toFixed(2)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
