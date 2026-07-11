'use client'

import {
  Search, Layers, Binoculars, TrendingUp, Plus,
} from 'lucide-react'
import { SEO_COLORS, scoreLabel } from './seoConstants.js'

function MetricTile({ label, value, sub, color, icon: Icon }) {
  return (
    <div className="card seo-metric-tile">
      <div className="seo-metric-top">
        <div className="seo-metric-icon" style={{ background: `${color}18`, color }}>
          <Icon size={18} strokeWidth={2} />
        </div>
        <div>
          <div className="seo-metric-value">{value ?? '—'}</div>
          <div className="seo-metric-label">{label}</div>
        </div>
      </div>
      {sub && <div className="seo-metric-sub">{sub}</div>}
    </div>
  )
}

const QUICK_ACTIONS = [
  { id: 'competitors', label: 'Analyze Competitor', icon: Binoculars, color: SEO_COLORS.competitors },
  { id: 'audit', label: 'Audit Website', icon: Search, color: SEO_COLORS.audit },
  { id: 'keywords', label: 'Cluster Keywords', icon: Layers, color: SEO_COLORS.keywords },
  { id: 'rankings', label: 'Check Rankings', icon: TrendingUp, color: SEO_COLORS.rankings },
]

export default function SeoDashboard({ stats, loading, onTabChange, onQuickAction }) {
  const score = stats?.seoScore
  const scoreText = score != null ? scoreLabel(score) : null

  return (
    <div className="seo-dashboard">
      <div className="grid-4 seo-metrics-grid">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 96, borderRadius: 12 }} />
          ))
        ) : (
          <>
            <MetricTile
              label="SEO Score"
              value={score ?? '—'}
              sub={scoreText ? `${scoreText}${stats?.issueCount ? ` · ${stats.issueCount} issue${stats.issueCount !== 1 ? 's' : ''}` : ''}` : 'Run an audit to get your score'}
              color={SEO_COLORS.audit}
              icon={Search}
            />
            <MetricTile
              label="Keywords"
              value={stats?.keywordCount ?? 0}
              sub={stats?.clusterCount ? `${stats.clusterCount} cluster${stats.clusterCount !== 1 ? 's' : ''} built` : 'Track & cluster keywords'}
              color={SEO_COLORS.keywords}
              icon={Layers}
            />
            <MetricTile
              label="Competitors"
              value={stats?.competitorCount ?? 0}
              sub={stats?.competitorCount ? 'Analyses saved' : 'No analyses yet'}
              color={SEO_COLORS.competitors}
              icon={Binoculars}
            />
            <MetricTile
              label="Pages"
              value={stats?.pageCount ?? 0}
              sub={
                stats?.criticalCount
                  ? `${stats.criticalCount} critical · ${stats.warningCount || 0} warnings`
                  : stats?.pageCount
                    ? 'All pages audited'
                    : 'No landing pages'
              }
              color={SEO_COLORS.audit}
              icon={Search}
            />
          </>
        )}
      </div>

      <div className="seo-quick-actions">
        <span className="seo-quick-actions-label">Quick actions</span>
        <div className="seo-quick-actions-row">
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a.id}
              type="button"
              className="seo-quick-action-btn"
              onClick={() => (onQuickAction ? onQuickAction(a.id) : onTabChange?.(a.id))}
            >
              <Plus size={14} style={{ color: a.color }} />
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
