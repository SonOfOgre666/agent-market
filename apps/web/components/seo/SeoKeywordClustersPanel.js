'use client'

import { useEffect, useState } from 'react'
import { api } from '../../lib/api.js'
import { useToast } from '../Toast.js'
import { Layers, Sparkles } from 'lucide-react'
import SeoAnalysisProgress, { useAnalysisProgress } from './SeoAnalysisProgress.js'
import { INTENT_COLOR, SEO_COLORS, formatRelativeTime } from './seoConstants.js'

const PROGRESS_STEPS = [
  'Parsing keywords',
  'Analyzing intent',
  'Grouping clusters',
  'Generating report',
]

export default function SeoKeywordClustersPanel({ onResult }) {
  const toast = useToast()
  const [seeds, setSeeds] = useState('')
  const [context, setContext] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [recent, setRecent] = useState([])
  const progressIndex = useAnalysisProgress(PROGRESS_STEPS, loading)

  useEffect(() => {
    api.recentSeoKeywordClusters({ limit: 6 }).then((r) => setRecent(r.items || [])).catch(() => {})
  }, [])

  function loadRecent(row) {
    setSeeds((row.seed_keywords || []).join('\n'))
    setResult({ clusters: row.clusters, summary: row.summary, id: row.id })
    onResult?.(row)
  }

  async function runCluster() {
    const seed_keywords = seeds.split('\n').map((s) => s.trim()).filter(Boolean)
    if (!seed_keywords.length) {
      toast.error('Add at least one keyword')
      return
    }
    setLoading(true)
    try {
      const out = await api.clusterSeoKeywords({ seed_keywords, business_context: context })
      setResult(out)
      toast.success(`Built ${out.clusters?.length || 0} clusters`)
      const r = await api.recentSeoKeywordClusters({ limit: 6 })
      setRecent(r.items || [])
      onResult?.(out)
    } catch (err) {
      toast.error(err.message || 'Clustering failed')
    } finally {
      setLoading(false)
    }
  }

  const clustersByIntent = {}
  for (const c of result?.clusters || []) {
    const intent = c.intent || 'other'
    if (!clustersByIntent[intent]) clustersByIntent[intent] = []
    clustersByIntent[intent].push(c)
  }

  return (
    <div className="seo-feature-layout">
      <div className="seo-feature-card" style={{ '--seo-accent': SEO_COLORS.keywords }}>
        <div className="seo-feature-header">
          <div className="seo-feature-icon" style={{ background: `${SEO_COLORS.keywords}18`, color: SEO_COLORS.keywords }}>
            <Layers size={20} strokeWidth={2} />
          </div>
          <div>
            <h2 className="seo-feature-title">Keyword Clustering</h2>
            <p className="seo-feature-desc">
              Group seed keywords by search intent to plan content and landing pages.
            </p>
          </div>
        </div>

        <div className="seo-cluster-form">
          <div className="seo-field">
            <label className="form-label">Paste keywords (one per line)</label>
            <textarea
              className="form-input seo-keyword-textarea"
              rows={6}
              value={seeds}
              onChange={(e) => setSeeds(e.target.value)}
              placeholder={'crm software\ncrm for startups\nbest crm\nwhat is crm\nhubspot vs salesforce\nbuy crm'}
            />
          </div>
          <div className="seo-field">
            <label className="form-label">Business</label>
            <input
              className="form-input"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="CRM SaaS"
            />
          </div>
          <button type="button" className="btn btn-primary" onClick={runCluster} disabled={loading}>
            <Sparkles size={14} />
            {loading ? 'Clustering…' : 'Cluster Keywords'}
          </button>
          {loading && <SeoAnalysisProgress steps={PROGRESS_STEPS} activeIndex={progressIndex} />}
        </div>
      </div>

      {recent.length > 0 && !result && (
        <div className="card">
          <div className="card-title">Recent clusters</div>
          <div className="seo-recent-grid">
            {recent.map((row) => (
              <button key={row.id} type="button" className="seo-recent-card" onClick={() => loadRecent(row)}>
                <div className="seo-recent-name">{(row.seed_keywords || []).slice(0, 2).join(', ')}</div>
                <div className="seo-recent-meta">{formatRelativeTime(row.created_at)}</div>
                <div className="seo-recent-score">{(row.clusters || []).length} clusters</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {result?.clusters?.length > 0 && (
        <div className="card seo-results-card">
          <div className="card-title">Clusters by intent</div>
          {result.summary && (
            <p className="text-muted text-sm" style={{ marginTop: 0 }}>{result.summary}</p>
          )}
          <div className="seo-intent-groups">
            {Object.entries(clustersByIntent).map(([intent, clusters]) => (
              <div key={intent} className="seo-intent-group">
                <div
                  className="seo-intent-label"
                  style={{
                    color: INTENT_COLOR[intent] || '#64748b',
                    background: `${INTENT_COLOR[intent] || '#64748b'}18`,
                  }}
                >
                  {intent.charAt(0).toUpperCase() + intent.slice(1)}
                </div>
                <div className="seo-chip-cloud">
                  {clusters.flatMap((c) => (c.keywords || [c.name]).filter(Boolean)).map((kw) => (
                    <span
                      key={`${intent}-${kw}`}
                      className="seo-keyword-chip"
                      style={{
                        borderColor: `${INTENT_COLOR[intent] || '#64748b'}40`,
                        color: INTENT_COLOR[intent] || '#64748b',
                        background: `${INTENT_COLOR[intent] || '#64748b'}10`,
                      }}
                    >
                      {kw}
                    </span>
                  ))}
                </div>
                {clusters.map((c, i) => (
                  c.content_idea && (
                    <p key={i} className="seo-cluster-idea text-muted text-sm">{c.name}: {c.content_idea}</p>
                  )
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
