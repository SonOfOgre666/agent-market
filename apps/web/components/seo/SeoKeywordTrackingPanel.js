'use client'

import { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api.js'
import { useToast } from '../Toast.js'
import { TrendingUp, RefreshCw, Plus, Trash2, ArrowUp, ArrowDown, Minus } from 'lucide-react'
import SeoAnalysisProgress, { useAnalysisProgress } from './SeoAnalysisProgress.js'
import { SEO_COLORS } from './seoConstants.js'

const PROGRESS_STEPS = [
  'Loading keywords',
  'Querying search results',
  'Matching domain',
  'Saving rankings',
]

function TrendBadge({ current, previous }) {
  if (current == null) return <span className="text-muted">—</span>
  if (previous == null) return <span className="seo-trend neutral"><Minus size={12} /> New</span>
  const diff = previous - current
  if (diff > 0) {
    return (
      <span className="seo-trend up">
        <ArrowUp size={12} /> +{diff}
      </span>
    )
  }
  if (diff < 0) {
    return (
      <span className="seo-trend down">
        <ArrowDown size={12} /> {diff}
      </span>
    )
  }
  return <span className="seo-trend neutral"><Minus size={12} /> —</span>
}

export default function SeoKeywordTrackingPanel({ autoCheck = false }) {
  const toast = useToast()
  const [targets, setTargets] = useState([])
  const [rankHistory, setRankHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [domain, setDomain] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const progressIndex = useAnalysisProgress(PROGRESS_STEPS, checking)

  const previousPositions = useMemo(() => {
    const map = {}
    const sorted = [...rankHistory].sort((a, b) => new Date(b.checked_at) - new Date(a.checked_at))
    for (const snap of sorted) {
      if (!map[snap.target_id]) {
        map[snap.target_id] = { current: snap.position, previous: null, count: 1 }
      } else if (map[snap.target_id].count === 1) {
        map[snap.target_id].previous = snap.position
        map[snap.target_id].count = 2
      }
    }
    return map
  }, [rankHistory])

  async function load() {
    setLoading(true)
    try {
      const [targetsOut, historyOut] = await Promise.all([
        api.seoKeywordTargets(),
        api.seoRankHistory({ limit: 100 }),
      ])
      setTargets(targetsOut.items || [])
      setRankHistory(historyOut.items || [])
      const items = targetsOut.items || []
      if (items.length && !domain) {
        setDomain(items[0].target_domain || '')
      }
    } catch (err) {
      toast.error(err.message || 'Failed to load keywords')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (autoCheck && targets.length && !checking) {
      checkRanks()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCheck])

  async function addTarget(e) {
    e.preventDefault()
    try {
      await api.addSeoKeywordTarget({ keyword, target_domain: domain })
      setKeyword('')
      toast.success('Keyword added')
      setShowAddForm(false)
      load()
    } catch (err) {
      toast.error(err.message || 'Add failed')
    }
  }

  async function removeTarget(id) {
    try {
      await api.deleteSeoKeywordTarget(id)
      setTargets((prev) => prev.filter((t) => t.id !== id))
    } catch (err) {
      toast.error(err.message || 'Delete failed')
    }
  }

  async function checkRanks() {
    setChecking(true)
    try {
      const out = await api.checkSeoKeywordRanks()
      toast.success(`Checked ${out.checked || 0} keyword(s)`)
      load()
    } catch (err) {
      toast.error(err.message || 'Rank check failed')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="seo-feature-layout">
      <div className="seo-feature-card" style={{ '--seo-accent': SEO_COLORS.rankings }}>
        <div className="seo-feature-header">
          <div className="seo-feature-icon" style={{ background: `${SEO_COLORS.rankings}18`, color: SEO_COLORS.rankings }}>
            <TrendingUp size={20} strokeWidth={2} />
          </div>
          <div>
            <h2 className="seo-feature-title">Rank Tracking</h2>
            <p className="seo-feature-desc">
              Track important keywords and watch how your rankings change over time.
            </p>
          </div>
        </div>

        <div className="seo-rank-controls">
          <div className="seo-field" style={{ flex: 1, minWidth: 200 }}>
            <label className="form-label">Domain</label>
            <input
              className="form-input"
              placeholder="example.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
          </div>
          <div className="seo-rank-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowAddForm((v) => !v)}
            >
              <Plus size={14} /> Add Keyword
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={checkRanks}
              disabled={checking || !targets.length}
            >
              <RefreshCw size={14} className={checking ? 'spin' : undefined} />
              {checking ? 'Checking…' : 'Check Rankings'}
            </button>
          </div>
        </div>

        {showAddForm && (
          <form onSubmit={addTarget} className="seo-rank-add-form">
            <input
              className="form-input"
              placeholder="best crm software"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              style={{ flex: 2 }}
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={!keyword || !domain}>
              <Plus size={14} /> Add
            </button>
          </form>
        )}

        {checking && <SeoAnalysisProgress steps={PROGRESS_STEPS} activeIndex={progressIndex} />}
      </div>

      {loading ? (
        <div className="skeleton" style={{ height: 160, borderRadius: 12 }} />
      ) : targets.length === 0 ? (
        <div className="empty-state-enhanced card">
          <div className="empty-state-icon">📈</div>
          <div className="empty-state-title">Start tracking rankings</div>
          <p className="empty-state-desc">
            Track important keywords and watch how they change over time.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => setShowAddForm(true)}>
            <Plus size={14} /> Add First Keyword
          </button>
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="data-table seo-rank-table">
            <thead>
              <tr>
                <th>Keyword</th>
                <th>Position</th>
                <th>Trend</th>
                <th>Domain</th>
                <th>Last check</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {targets.map((t) => {
                const trend = previousPositions[t.id]
                return (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 500 }}>{t.keyword}</td>
                    <td style={{ fontWeight: 700, fontSize: '1rem' }}>
                      {t.last_position != null ? `#${t.last_position}` : '—'}
                    </td>
                    <td>
                      <TrendBadge
                        current={t.last_position}
                        previous={trend?.previous ?? null}
                      />
                    </td>
                    <td className="text-muted">{t.target_domain}</td>
                    <td className="text-muted" style={{ fontSize: '0.8rem' }}>
                      {t.last_checked_at ? new Date(t.last_checked_at).toLocaleString() : 'Never'}
                    </td>
                    <td>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeTarget(t.id)} aria-label="Remove">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
