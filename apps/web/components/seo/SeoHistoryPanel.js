'use client'

import {
  Search, Layers, Binoculars, TrendingUp, ChevronRight,
} from 'lucide-react'
import { formatRelativeTime, SEO_COLORS } from './seoConstants.js'

const TYPE_META = {
  audit: { label: 'SEO Audit', icon: Search, color: SEO_COLORS.audit },
  cluster: { label: 'Keyword Cluster', icon: Layers, color: SEO_COLORS.keywords },
  competitor: { label: 'Competitor Report', icon: Binoculars, color: SEO_COLORS.competitors },
  rank: { label: 'Rank Check', icon: TrendingUp, color: SEO_COLORS.rankings },
}

function HistoryItem({ item, onSelect }) {
  const meta = TYPE_META[item.type] || TYPE_META.audit
  const Icon = meta.icon

  return (
    <button type="button" className="seo-history-item" onClick={() => onSelect?.(item)}>
      <div className="seo-history-icon" style={{ background: `${meta.color}15`, color: meta.color }}>
        <Icon size={16} strokeWidth={2} />
      </div>
      <div className="seo-history-body">
        <div className="seo-history-title">{item.title}</div>
        <div className="seo-history-meta">
          {meta.label}
          {item.subtitle ? ` · ${item.subtitle}` : ''}
        </div>
      </div>
      <div className="seo-history-right">
        <span className="seo-history-time">{formatRelativeTime(item.date)}</span>
        <ChevronRight size={14} className="text-muted" />
      </div>
    </button>
  )
}

export default function SeoHistoryPanel({ items = [], onSelect, emptyHint }) {
  if (!items.length) {
    return (
      <div className="card seo-history-empty">
        <p className="text-muted text-sm" style={{ margin: 0 }}>
          {emptyHint || 'Run an audit, cluster keywords, or analyze a competitor to build your SEO history.'}
        </p>
      </div>
    )
  }

  return (
    <div className="card seo-history-panel">
      <div className="card-title">Recent activity</div>
      <div className="seo-history-list">
        {items.map((item) => (
          <HistoryItem key={item.id} item={item} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}

export function buildHistoryItems({ audit, clusters = [], competitors = [], rankSnapshots = [] }) {
  const items = []

  if (audit?.page_count != null) {
    items.push({
      id: 'audit-latest',
      type: 'audit',
      title: `Landing pages · avg score ${audit.average_score ?? '—'}`,
      subtitle: `${audit.page_count} page${audit.page_count !== 1 ? 's' : ''}`,
      date: audit.fetched_at || new Date(),
      payload: audit,
    })
  }

  for (const c of clusters.slice(0, 5)) {
    items.push({
      id: `cluster-${c.id}`,
      type: 'cluster',
      title: (c.seed_keywords || []).slice(0, 2).join(', ') || 'Keyword cluster',
      subtitle: `${(c.clusters || []).length} clusters`,
      date: c.created_at,
      payload: c,
    })
  }

  for (const c of competitors.slice(0, 5)) {
    items.push({
      id: `competitor-${c.id}`,
      type: 'competitor',
      title: c.competitor_name,
      subtitle: (c.analysis?.recommended_actions || []).length
        ? `${(c.analysis.recommended_actions).length} actions`
        : undefined,
      date: c.created_at,
      payload: c,
    })
  }

  const seenRank = new Set()
  for (const s of rankSnapshots) {
    if (seenRank.has(s.target_id)) continue
    seenRank.add(s.target_id)
    items.push({
      id: `rank-${s.id}`,
      type: 'rank',
      title: s.keyword,
      subtitle: s.position != null ? `#${s.position} · ${s.target_domain}` : s.target_domain,
      date: s.checked_at,
      payload: s,
    })
  }

  return items
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 12)
}
