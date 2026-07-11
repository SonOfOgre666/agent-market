'use client'

import { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api.js'
import { useToast } from '../Toast.js'
import { Search, RefreshCw, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import SeoAnalysisProgress, { useAnalysisProgress } from './SeoAnalysisProgress.js'
import SeoAiRecommendations from './SeoAiRecommendations.js'
import { SEO_COLORS, SEVERITY_COLOR, scoreEmoji, scoreLabel } from './seoConstants.js'

const PROGRESS_STEPS = [
  'Loading pages',
  'Checking headlines',
  'Analyzing content',
  'Scoring issues',
]

export default function SeoLandingAuditPanel({ onAuditLoaded }) {
  const toast = useToast()
  const [audit, setAudit] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expandedPage, setExpandedPage] = useState(null)
  const progressIndex = useAnalysisProgress(PROGRESS_STEPS, loading)

  async function load() {
    setLoading(true)
    try {
      const out = await api.seoLandingPageAudit()
      const enriched = { ...out, fetched_at: new Date().toISOString() }
      setAudit(enriched)
      onAuditLoaded?.(enriched)
    } catch (err) {
      toast.error(err.message || 'SEO audit failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const stats = useMemo(() => {
    if (!audit?.pages) return null
    let warnings = 0
    let missingMeta = 0
    for (const p of audit.pages) {
      for (const issue of p.issues || []) {
        if (issue.severity === 'medium' || issue.severity === 'low') warnings++
        if (issue.type?.includes('title') || issue.type?.includes('meta') || issue.type === 'missing_subheadline') {
          missingMeta++
        }
      }
    }
    return {
      warnings,
      missingMeta,
      critical: audit.summary?.critical ?? 0,
    }
  }, [audit])

  const scoreColor = (score) => {
    if (score >= 90) return SEO_COLORS.audit
    if (score >= 70) return '#f59e0b'
    return SEVERITY_COLOR.high
  }

  return (
    <div className="seo-feature-layout">
      <div className="seo-feature-card" style={{ '--seo-accent': SEO_COLORS.audit }}>
        <div className="seo-feature-header">
          <div className="seo-feature-icon" style={{ background: `${SEO_COLORS.audit}18`, color: SEO_COLORS.audit }}>
            <Search size={20} strokeWidth={2} />
          </div>
          <div style={{ flex: 1 }}>
            <h2 className="seo-feature-title">Landing Page Audit</h2>
            <p className="seo-feature-desc">
              On-page SEO checks for your landing pages — headlines, content depth, forms, and metadata.
            </p>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : undefined} />
            {loading ? 'Auditing…' : 'Re-run audit'}
          </button>
        </div>
        {loading && <SeoAnalysisProgress steps={PROGRESS_STEPS} activeIndex={progressIndex} />}
      </div>

      {audit && !loading && (
        <>
          <div className="grid-4 seo-audit-stats">
            <div className="card seo-audit-stat-card">
              <div className="seo-audit-stat-label">SEO Health</div>
              <div className="seo-audit-stat-value" style={{ color: scoreColor(audit.average_score) }}>
                {audit.average_score ?? '—'}
              </div>
              <div className="seo-audit-stat-sub">{scoreLabel(audit.average_score)}</div>
            </div>
            <div className="card seo-audit-stat-card">
              <div className="seo-audit-stat-label">Pages</div>
              <div className="seo-audit-stat-value">{audit.page_count}</div>
              <div className="seo-audit-stat-sub">Audited</div>
            </div>
            <div className="card seo-audit-stat-card">
              <div className="seo-audit-stat-label">Critical</div>
              <div className="seo-audit-stat-value" style={{ color: SEVERITY_COLOR.high }}>
                {stats?.critical ?? 0}
              </div>
              <div className="seo-audit-stat-sub">High severity</div>
            </div>
            <div className="card seo-audit-stat-card">
              <div className="seo-audit-stat-label">Warnings</div>
              <div className="seo-audit-stat-value" style={{ color: SEVERITY_COLOR.medium }}>
                {stats?.warnings ?? 0}
              </div>
              <div className="seo-audit-stat-sub">{stats?.missingMeta ?? 0} meta issues</div>
            </div>
          </div>

          {audit.pages?.length > 0 ? (
            <div className="card seo-page-list">
              <div className="card-title">Pages</div>
              {audit.pages.map((p) => {
                const open = expandedPage === (p.id || p.slug)
                return (
                  <div key={p.id || p.slug} className="seo-page-row">
                    <button
                      type="button"
                      className="seo-page-row-header"
                      onClick={() => setExpandedPage(open ? null : (p.id || p.slug))}
                    >
                      <div className="seo-page-row-info">
                        <span className="seo-page-name">{p.title || p.slug}</span>
                        <span className="text-muted text-sm">{p.slug}</span>
                      </div>
                      <div className="seo-page-row-score" style={{ color: scoreColor(p.score) }}>
                        <span className="seo-page-emoji">{scoreEmoji(p.score)}</span>
                        <span>{p.score}</span>
                      </div>
                      {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                    {open && (
                      <div className="seo-page-detail">
                        {(p.issues || []).length === 0 ? (
                          <p className="text-muted text-sm" style={{ margin: 0 }}>No issues found — great job!</p>
                        ) : (
                          <>
                            <div className="form-label">Issues</div>
                            <ul className="seo-issue-list">
                              {p.issues.map((issue, i) => (
                                <li key={i} style={{ color: SEVERITY_COLOR[issue.severity] || 'inherit' }}>
                                  <AlertTriangle size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                                  {issue.message}
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                        <SeoAiRecommendations page={p} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="empty-state-enhanced card">
              <div className="empty-state-icon">🔍</div>
              <div className="empty-state-title">No landing pages yet</div>
              <p className="empty-state-desc">
                Create landing pages to run a technical SEO audit on your content.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
