'use client'

import { useEffect, useState } from 'react'
import { api } from '../../lib/api.js'
import { useToast } from '../Toast.js'
import { Binoculars, Check } from 'lucide-react'
import SeoAnalysisProgress, { useAnalysisProgress } from './SeoAnalysisProgress.js'
import { PRIORITY_COLOR, SEO_COLORS, formatRelativeTime } from './seoConstants.js'

const PROGRESS_STEPS = [
  'Crawling website',
  'Reading content',
  'Checking metadata',
  'Searching ad library',
  'Generating report',
]

const DELIVERABLES = [
  'SEO overview',
  'Top keywords',
  'Landing pages',
  'Ad copy',
  'Positioning',
  'Weaknesses',
  'Opportunities',
]

export default function CompetitiveAnalysisPanel({ onResult }) {
  const toast = useToast()
  const [competitorName, setCompetitorName] = useState('')
  const [website, setWebsite] = useState('')
  const [ourContext, setOurContext] = useState('')
  const [countries, setCountries] = useState('US')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [recent, setRecent] = useState([])
  const progressIndex = useAnalysisProgress(PROGRESS_STEPS, loading)

  useEffect(() => {
    api.recentCompetitiveAnalyses({ limit: 8 }).then((r) => setRecent(r.items || [])).catch(() => {})
  }, [])

  function loadRecent(row) {
    setCompetitorName(row.competitor_name || '')
    setResult({
      id: row.id,
      analysis: row.analysis,
      pages_scraped: row.pages_scraped,
      ads_library_count: row.ads_library_count,
      ads_library_error: row.ads_library_error,
    })
    onResult?.(row)
  }

  async function runAnalysis() {
    if (!competitorName.trim()) {
      toast.error('Enter a competitor name')
      return
    }
    setLoading(true)
    setResult(null)
    try {
      const competitor_urls = website.trim() ? [website.trim()] : []
      const out = await api.runCompetitiveAnalysis({
        competitor_name: competitorName.trim(),
        competitor_urls,
        our_business_context: ourContext.trim() || undefined,
        search_terms: competitorName.trim(),
        ad_reached_countries: countries.trim() ? countries.split(/[\s,]+/).filter(Boolean) : undefined,
      })
      setResult(out)
      toast.success('Competitive analysis complete')
      const r = await api.recentCompetitiveAnalyses({ limit: 8 })
      setRecent(r.items || [])
      onResult?.(out)
    } catch (err) {
      toast.error(err.message || 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }

  const analysis = result?.analysis

  return (
    <div className="seo-feature-layout">
      <div className="seo-feature-card" style={{ '--seo-accent': SEO_COLORS.competitors }}>
        <div className="seo-feature-header">
          <div className="seo-feature-icon" style={{ background: `${SEO_COLORS.competitors}18`, color: SEO_COLORS.competitors }}>
            <Binoculars size={20} strokeWidth={2} />
          </div>
          <div>
            <h2 className="seo-feature-title">Competitive Analysis</h2>
            <p className="seo-feature-desc">
              Analyze competitor websites, ads, SEO strategy, landing pages, and positioning.
            </p>
          </div>
        </div>

        <div className="seo-two-col">
          <div className="seo-form-col">
            <div className="seo-field">
              <label className="form-label">Who is your competitor?</label>
              <input
                className="form-input"
                value={competitorName}
                onChange={(e) => setCompetitorName(e.target.value)}
                placeholder="e.g. Nike"
              />
            </div>
            <div className="seo-field">
              <label className="form-label">Website</label>
              <input
                className="form-input"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://nike.com"
              />
            </div>
            <div className="seo-field">
              <label className="form-label">Your business</label>
              <textarea
                className="form-input"
                rows={3}
                value={ourContext}
                onChange={(e) => setOurContext(e.target.value)}
                placeholder="We sell premium running shoes…"
              />
            </div>
            <div className="seo-field">
              <label className="form-label">Countries (for ad library)</label>
              <input
                className="form-input"
                value={countries}
                onChange={(e) => setCountries(e.target.value)}
                placeholder="US, CA, FR"
              />
            </div>
            <button type="button" className="btn btn-primary" onClick={runAnalysis} disabled={loading}>
              {loading ? 'Analyzing…' : 'Analyze Competitor'}
            </button>
            {loading && <SeoAnalysisProgress steps={PROGRESS_STEPS} activeIndex={progressIndex} />}
          </div>

          <div className="seo-side-panel">
            <div className="seo-side-panel-title">What you&apos;ll get</div>
            <ul className="seo-checklist">
              {DELIVERABLES.map((d) => (
                <li key={d}><Check size={14} /> {d}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {recent.length > 0 && (
        <div className="card">
          <div className="card-title">Recent analyses</div>
          <div className="seo-recent-grid">
            {recent.map((row) => (
              <button
                key={row.id}
                type="button"
                className={`seo-recent-card${result?.id === row.id ? ' selected' : ''}`}
                onClick={() => loadRecent(row)}
              >
                <div className="seo-recent-name">{row.competitor_name}</div>
                <div className="seo-recent-meta">{formatRelativeTime(row.created_at)}</div>
                {(row.analysis?.recommended_actions || []).length > 0 && (
                  <div className="seo-recent-score">
                    {(row.analysis.recommended_actions).length} actions
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {analysis?.positioning_summary && (
        <div className="card seo-results-card">
          <div className="card-title">Analysis results — {competitorName || result?.competitor_name}</div>

          {result?.pages_scraped?.length > 0 && (
            <div className="seo-scraped-summary">
              {result.pages_scraped.filter((p) => p.ok).length} pages scraped
              {result.ads_library_count > 0 && ` · ${result.ads_library_count} ads sampled`}
            </div>
          )}

          <p className="seo-positioning"><strong>Positioning</strong> — {analysis.positioning_summary}</p>

          {analysis.recommended_actions?.length > 0 && (
            <>
              <div className="form-label" style={{ marginTop: '1rem' }}>Recommended actions</div>
              <ul className="seo-action-list">
                {analysis.recommended_actions.slice(0, 8).map((a, i) => (
                  <li key={i}>
                    <span
                      className="badge"
                      style={{
                        background: `${PRIORITY_COLOR[a.priority] || PRIORITY_COLOR.medium}22`,
                        color: PRIORITY_COLOR[a.priority],
                      }}
                    >
                      {a.priority}
                    </span>
                    {a.action}
                    {a.rationale && <span className="text-muted"> — {a.rationale}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}

          {(analysis.keyword_opportunities?.length > 0 || analysis.messaging_themes?.length > 0) && (
            <div className="seo-results-grid">
              {analysis.keyword_opportunities?.length > 0 && (
                <div>
                  <div className="form-label">Keyword opportunities</div>
                  <ul className="seo-bullet-list">
                    {analysis.keyword_opportunities.slice(0, 6).map((k) => <li key={k}>{k}</li>)}
                  </ul>
                </div>
              )}
              {analysis.messaging_themes?.length > 0 && (
                <div>
                  <div className="form-label">Messaging themes</div>
                  <ul className="seo-bullet-list">
                    {analysis.messaging_themes.slice(0, 6).map((m) => <li key={m}>{m}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
