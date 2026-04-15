'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import AppLayout from '../../components/AppLayout.js'
import { api } from '../../lib/api.js'
import { useToast } from '../../components/Toast.js'

const PLATFORM_LABEL = {
  google_ads: 'Google Ads', facebook: 'Facebook', linkedin: 'LinkedIn',
  tiktok: 'TikTok', instagram: 'Instagram',
}
const PLATFORM_COLOR = {
  google_ads: '#4285f4', facebook: '#1877f2', linkedin: '#0a66c2',
  tiktok: '#ff0050', instagram: '#e1306c',
}
const STATUS_COLOR = { draft: '#64748b', active: '#10b981', paused: '#f59e0b', ended: '#ef4444' }

export default function AdsPage() {
  const [summary, setSummary] = useState(null)
  const [campaigns, setCampaigns] = useState([])
  const [pages, setPages] = useState([])
  const [leads, setLeads] = useState({ total: 0 })
  const [loading, setLoading] = useState(true)
  const toast = useToast()

  useEffect(() => {
    Promise.all([
      api.budgetSummary().catch(() => null),
      api.campaigns({ per_page: 5 }).catch(() => ({ items: [] })),
      api.landingPages({ per_page: 5 }).catch(() => ({ items: [] })),
      api.leads({ per_page: 1 }).catch(() => ({ total: 0 })),
    ]).then(([s, c, p, l]) => {
      setSummary(s)
      setCampaigns(c.items || [])
      setPages(p.items || [])
      setLeads(l)
    }).catch(e => toast.error(e.message)).finally(() => setLoading(false))
  }, [])

  return (
    <AppLayout>
      <div className="page-header">
        <h1 className="page-title">Ads & Campaigns</h1>
        <div className="flex gap-2">
          <Link href="/ads/campaigns" className="btn btn-secondary">All Campaigns</Link>
          <Link href="/ads/landing-pages" className="btn btn-secondary">Landing Pages</Link>
          <Link href="/ads/leads" className="btn btn-secondary">Leads</Link>
        </div>
      </div>

      {/* KPI summary */}
      {summary && (
        <div className="grid-4" style={{ marginBottom: '1.5rem' }}>
          {[
            { label: 'Total Budget', value: `$${summary.total_budget?.toLocaleString()}` },
            { label: 'Total Spend', value: `$${summary.total_spend?.toLocaleString()}` },
            { label: 'Remaining', value: `$${summary.budget_remaining?.toLocaleString()}` },
            { label: 'Leads', value: leads.total?.toLocaleString() || '0' },
          ].map((s, i) => (
            <div key={i} className="card stat-card">
              <div className="stat-value">{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {summary && (
        <div className="grid-4" style={{ marginBottom: '1.5rem' }}>
          {[
            { label: 'CTR', value: `${summary.ctr}%` },
            { label: 'CPC', value: summary.cpc ? `$${summary.cpc}` : '—' },
            { label: 'CPA', value: summary.cpa ? `$${summary.cpa}` : '—' },
            { label: 'Active Campaigns', value: summary.active_campaigns },
          ].map((s, i) => (
            <div key={i} className="card stat-card">
              <div className="stat-value">{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        {/* Recent campaigns */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>Recent Campaigns</div>
            <Link href="/ads/campaigns" style={{ fontSize: '0.75rem', color: 'var(--primary)' }}>View all</Link>
          </div>
          {loading ? <div className="skeleton" style={{ height: 120 }} /> : campaigns.length === 0 ? (
            <div style={{ color: 'var(--fg-muted)', fontSize: '0.875rem', textAlign: 'center', padding: '1.5rem 0' }}>
              No campaigns yet.{' '}
              <Link href="/ads/campaigns" style={{ color: 'var(--primary)' }}>Create one</Link>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {campaigns.map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem', background: 'var(--surface-2)', borderRadius: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: PLATFORM_COLOR[c.platform] || '#64748b', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--fg-muted)' }}>{PLATFORM_LABEL[c.platform] || c.platform}</div>
                  </div>
                  <span style={{ fontSize: '0.7rem', color: STATUS_COLOR[c.status] || '#64748b', fontWeight: 500 }}>{c.status}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--fg-muted)' }}>${(c.budget?.amount || 0).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent landing pages */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>Landing Pages</div>
            <Link href="/ads/landing-pages" style={{ fontSize: '0.75rem', color: 'var(--primary)' }}>View all</Link>
          </div>
          {loading ? <div className="skeleton" style={{ height: 120 }} /> : pages.length === 0 ? (
            <div style={{ color: 'var(--fg-muted)', fontSize: '0.875rem', textAlign: 'center', padding: '1.5rem 0' }}>
              No landing pages yet.{' '}
              <Link href="/ads/landing-pages" style={{ color: 'var(--primary)' }}>Create one</Link>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {pages.map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem', background: 'var(--surface-2)', borderRadius: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 500 }}>{p.title}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--fg-muted)', fontFamily: 'monospace' }}>/{p.slug}</div>
                  </div>
                  <span style={{ fontSize: '0.7rem', color: p.status === 'published' ? '#10b981' : '#64748b', fontWeight: 500 }}>{p.status}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--fg-muted)' }}>{p.lead_count} leads</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
