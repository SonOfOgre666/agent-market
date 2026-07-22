'use client'

import { useEffect, useState } from 'react'
import { api } from '../../lib/api.js'
import { useToast } from '../Toast.js'
import {
  Lightbulb, RefreshCw, Target, TrendingDown, Shuffle, Link2, Gauge, FlaskConical, Zap,
} from 'lucide-react'

const STATUS_COLOR = {
  overspending: '#ef4444',
  underspending: '#f59e0b',
  on_track: 'var(--success)',
}

const PRIORITY_COLOR = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: 'var(--fg-muted)',
}

export default function AdsOptimizationPanel() {
  const toast = useToast()
  const [campaigns, setCampaigns] = useState([])
  const [pacing, setPacing] = useState(null)
  const [pacingLoading, setPacingLoading] = useState(false)
  const [targetCpa, setTargetCpa] = useState('')
  const [targetRoas, setTargetRoas] = useState('')
  const [negCampaignId, setNegCampaignId] = useState('')
  const [negLoading, setNegLoading] = useState(false)
  const [recentNegatives, setRecentNegatives] = useState([])
  const [reallocation, setReallocation] = useState(null)
  const [reallocLoading, setReallocLoading] = useState(false)
  const [reallocApplyLoading, setReallocApplyLoading] = useState(false)
  const [attribution, setAttribution] = useState(null)
  const [attrModel, setAttrModel] = useState('linear')
  const [attrLoading, setAttrLoading] = useState(false)
  const [bidOpt, setBidOpt] = useState(null)
  const [bidLoading, setBidLoading] = useState(false)
  const [bidApplyLoading, setBidApplyLoading] = useState(false)
  const [qualityScore, setQualityScore] = useState(null)
  const [qsLoading, setQsLoading] = useState(false)
  const [abTest, setAbTest] = useState(null)
  const [abLoading, setAbLoading] = useState(false)
  const [abApplyLoading, setAbApplyLoading] = useState(false)

  const targets = {
    target_cpa: targetCpa ? Number(targetCpa) : undefined,
    target_roas: targetRoas ? Number(targetRoas) : undefined,
  }

  useEffect(() => {
    Promise.all([
      api.campaigns({ per_page: 100, platform: 'google_ads' }).catch(() => ({ items: [] })),
      api.recentNegativeKeywords().catch(() => ({ items: [] })),
    ]).then(([c, n]) => {
      setCampaigns((c.items || []).filter((x) => x.platform === 'google_ads'))
      setRecentNegatives(n.items || [])
    })
    api.leadAttribution({ days: 90, model: 'linear' }).then(setAttribution).catch(() => {})
  }, [])

  async function runPacing() {
    setPacingLoading(true)
    try {
      const out = await api.runBudgetPacing({ ...targets, persist: true })
      setPacing(out)
      toast.success('Budget pacing analysis complete')
    } catch (err) {
      toast.error(err.message || 'Pacing analysis failed')
    } finally {
      setPacingLoading(false)
    }
  }

  async function runBidOptimization() {
    setBidLoading(true)
    try {
      const out = await api.runBidOptimization({ ...targets, persist: true })
      setBidOpt(out)
      toast.success(`Bid analysis: ${out.summary?.keyword_actions || 0} keyword actions`)
    } catch (err) {
      toast.error(err.message || 'Bid optimization failed')
    } finally {
      setBidLoading(false)
    }
  }

  async function applyBidOptimization(dryRun = false) {
    const recs = bidOpt?.keyword_recommendations || []
    if (!recs.length) {
      toast.error('Run bid analysis first')
      return
    }
    setBidApplyLoading(true)
    try {
      const out = await api.applyBidOptimization({
        keyword_recommendations: recs.filter((r) => r.level === 'keyword'),
        dry_run: dryRun,
      })
      toast.success(
        dryRun
          ? `Dry run: ${out.applied?.length || 0} bids would update`
          : `Applied ${out.applied?.length || 0} bid updates`,
      )
    } catch (err) {
      toast.error(err.message || 'Bid apply failed')
    } finally {
      setBidApplyLoading(false)
    }
  }

  async function runQualityScore() {
    setQsLoading(true)
    try {
      const out = await api.qualityScoreMonitor({})
      setQualityScore(out)
      toast.success('Quality Score report ready')
    } catch (err) {
      toast.error(err.message || 'Quality Score analysis failed')
    } finally {
      setQsLoading(false)
    }
  }

  async function runAbTest() {
    setAbLoading(true)
    try {
      const out = await api.runAssetAbTest({ min_impressions: 200 })
      setAbTest(out)
      toast.success(`Found ${out.summary?.experiments_found || 0} A/B opportunities`)
    } catch (err) {
      toast.error(err.message || 'A/B analysis failed')
    } finally {
      setAbLoading(false)
    }
  }

  async function applyAbTest(dryRun = false) {
    const experiments = abTest?.experiments || []
    if (!experiments.length) {
      toast.error('Run A/B analysis first')
      return
    }
    setAbApplyLoading(true)
    try {
      const out = await api.applyAssetAbTest({ experiments, dry_run: dryRun })
      toast.success(
        dryRun
          ? `Dry run: would pause ${out.applied?.length || 0} ads`
          : `Paused ${out.applied?.length || 0} underperforming ads`,
      )
    } catch (err) {
      toast.error(err.message || 'A/B apply failed')
    } finally {
      setAbApplyLoading(false)
    }
  }

  async function suggestNegatives() {
    if (!negCampaignId) {
      toast.error('Select a Google Ads campaign')
      return
    }
    setNegLoading(true)
    try {
      const out = await api.suggestNegativeKeywords({ campaign_id: negCampaignId })
      if (out.skipped) {
        toast.error(out.reason || 'Campaign not eligible')
        return
      }
      toast.success(`Found ${out.count || 0} negative keyword suggestions`)
      const n = await api.recentNegativeKeywords()
      setRecentNegatives(n.items || [])
    } catch (err) {
      toast.error(err.message || 'Negative keyword review failed')
    } finally {
      setNegLoading(false)
    }
  }

  async function runReallocation() {
    setReallocLoading(true)
    try {
      const out = await api.runBudgetReallocation(targets)
      setReallocation(out)
      toast.success(out.shifts?.length ? 'Budget shift recommended' : 'No shift recommended')
    } catch (err) {
      toast.error(err.message || 'Reallocation failed')
    } finally {
      setReallocLoading(false)
    }
  }

  async function applyReallocation(dryRun = false) {
    const shifts = reallocation?.shifts || []
    if (!shifts.length) {
      toast.error('Run reallocation analysis first')
      return
    }
    setReallocApplyLoading(true)
    try {
      const out = await api.applyBudgetReallocation({ shifts, dry_run: dryRun })
      toast.success(
        dryRun
          ? `Dry run: ${out.applied?.length || 0} budgets would change`
          : `Applied ${out.applied?.length || 0} budget shifts locally`,
      )
    } catch (err) {
      toast.error(err.message || 'Apply reallocation failed')
    } finally {
      setReallocApplyLoading(false)
    }
  }

  async function refreshAttribution() {
    setAttrLoading(true)
    try {
      const out = await api.leadAttribution({ days: 90, model: attrModel })
      setAttribution(out)
    } catch (err) {
      toast.error(err.message || 'Attribution load failed')
    } finally {
      setAttrLoading(false)
    }
  }

  async function loadAttributionForModel(model) {
    setAttrModel(model)
    setAttrLoading(true)
    try {
      const out = await api.leadAttribution({ days: 90, model })
      setAttribution(out)
    } catch (err) {
      toast.error(err.message || 'Attribution load failed')
    } finally {
      setAttrLoading(false)
    }
  }

  function attrValue(row) {
    if (row.credit != null) return Number(row.credit).toFixed(2)
    return row.count ?? 0
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="card">
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Target size={16} strokeWidth={2} />
          KPI targets (shared)
        </div>
        <p className="text-muted text-sm" style={{ marginTop: 0 }}>
          Used by pacing, bid optimization, and budget reallocation below.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label className="form-label">Target CPA ($)</label>
            <input
              className="form-input"
              type="number"
              min="0"
              step="0.01"
              value={targetCpa}
              onChange={(e) => setTargetCpa(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div>
            <label className="form-label">Target ROAS</label>
            <input
              className="form-input"
              type="number"
              min="0"
              step="0.1"
              value={targetRoas}
              onChange={(e) => setTargetRoas(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Zap size={16} strokeWidth={2} />
          Auto bid optimization (CPA / ROAS)
        </div>
        <p className="text-muted text-sm" style={{ marginTop: 0 }}>
          Analyze campaign and keyword bids against your CPA or ROAS targets. Review recommendations, then apply only when you are ready.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" onClick={runBidOptimization} disabled={bidLoading}>
            <RefreshCw size={14} className={bidLoading ? 'spin' : undefined} />
            {bidLoading ? 'Analyzing…' : 'Run bid analysis'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => applyBidOptimization(true)}
            disabled={bidApplyLoading || !bidOpt?.keyword_recommendations?.length}
          >
            Dry run apply
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => applyBidOptimization(false)}
            disabled={bidApplyLoading || !bidOpt?.keyword_recommendations?.length}
          >
            {bidApplyLoading ? 'Applying…' : 'Apply keyword bids'}
          </button>
        </div>
        {bidOpt?.summary && (
          <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <span>Campaign actions: <strong>{bidOpt.summary.campaign_actions}</strong></span>
            <span>Keyword actions: <strong>{bidOpt.summary.keyword_actions}</strong></span>
          </div>
        )}
        {bidOpt?.keyword_recommendations?.length > 0 && (
          <div style={{ marginTop: '1rem', overflowX: 'auto' }}>
            <table className="data-table" style={{ fontSize: '0.8rem' }}>
              <thead>
                <tr>
                  <th>Keyword</th>
                  <th>Action</th>
                  <th>CPC</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {bidOpt.keyword_recommendations.slice(0, 8).map((row) => (
                  <tr key={`${row.keyword_id}-${row.suggested_cpc}`}>
                    <td>{row.keyword_text}</td>
                    <td style={{ color: row.action === 'decrease' ? '#ef4444' : '#10b981' }}>{row.action}</td>
                    <td>${row.current_cpc?.toFixed?.(2)} → ${row.suggested_cpc?.toFixed?.(2)}</td>
                    <td className="text-muted">{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Gauge size={16} strokeWidth={2} />
          Quality Score monitoring
        </div>
        <p className="text-muted text-sm" style={{ marginTop: 0 }}>
          Keyword-level QS from Google Ads reporting with actionable recommendations.
        </p>
        <button type="button" className="btn btn-primary" onClick={runQualityScore} disabled={qsLoading}>
          <RefreshCw size={14} className={qsLoading ? 'spin' : undefined} />
          {qsLoading ? 'Loading…' : 'Run QS report'}
        </button>
        {qualityScore?.summary && (
          <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <span>Avg QS: <strong>{qualityScore.summary.average_quality_score ?? '—'}</strong></span>
            <span style={{ color: '#ef4444' }}>Low (≤4): <strong>{qualityScore.summary.low}</strong></span>
            <span style={{ color: '#f59e0b' }}>Mid (5–6): <strong>{qualityScore.summary.medium}</strong></span>
            <span style={{ color: '#10b981' }}>High (≥7): <strong>{qualityScore.summary.high}</strong></span>
          </div>
        )}
        {qualityScore?.recommendations?.length > 0 && (
          <ul style={{ margin: '0.75rem 0 0', paddingLeft: '1.25rem', fontSize: '0.8rem' }}>
            {qualityScore.recommendations.slice(0, 6).map((r) => (
              <li key={r.keyword_id} style={{ marginBottom: '0.35rem' }}>
                <span
                  className="badge"
                  style={{
                    background: `${PRIORITY_COLOR[r.priority] || PRIORITY_COLOR.medium}22`,
                    color: PRIORITY_COLOR[r.priority],
                    marginRight: 6,
                  }}
                >
                  QS {r.quality_score}
                </span>
                {r.keyword_text}: {r.message}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <FlaskConical size={16} strokeWidth={2} />
          A/B testing — ad assets
        </div>
        <p className="text-muted text-sm" style={{ marginTop: 0 }}>
          Compares ads within each ad group (min 200 impressions). Review winners, then pause losers only when you confirm.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" onClick={runAbTest} disabled={abLoading}>
            <RefreshCw size={14} className={abLoading ? 'spin' : undefined} />
            {abLoading ? 'Analyzing…' : 'Run A/B analysis'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => applyAbTest(false)}
            disabled={abApplyLoading || !abTest?.experiments?.length}
          >
            {abApplyLoading ? 'Applying…' : 'Pause losers'}
          </button>
        </div>
        {abTest?.experiments?.length > 0 && (
          <ul style={{ margin: '0.75rem 0 0', paddingLeft: '1.25rem', fontSize: '0.8rem' }}>
            {abTest.experiments.slice(0, 5).map((exp) => (
              <li key={`${exp.ad_group_id}-${exp.loser?.ad_id}`} style={{ marginBottom: '0.35rem' }}>
                <strong>{exp.ad_group_name}</strong> — {exp.recommendation}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Target size={16} strokeWidth={2} />
          Budget pacing
        </div>
        <p className="text-muted text-sm" style={{ marginTop: 0 }}>
          Month-to-date spend vs your campaign budgets — spot overspend and underspend early.
        </p>
        <button type="button" className="btn btn-primary" onClick={runPacing} disabled={pacingLoading}>
          <RefreshCw size={14} className={pacingLoading ? 'spin' : undefined} />
          {pacingLoading ? 'Analyzing…' : 'Run pacing analysis'}
        </button>

        {pacing?.summary && (
          <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.8rem' }}>
            <span>Overspending: <strong style={{ color: STATUS_COLOR.overspending }}>{pacing.summary.overspending}</strong></span>
            <span>Underspending: <strong style={{ color: STATUS_COLOR.underspending }}>{pacing.summary.underspending}</strong></span>
            <span>On track: <strong style={{ color: STATUS_COLOR.on_track }}>{pacing.summary.on_track}</strong></span>
            {pacing.summary.kpi_alerts != null && (
              <span>KPI alerts: <strong>{pacing.summary.kpi_alerts}</strong></span>
            )}
          </div>
        )}

        {pacing?.campaigns?.length > 0 && (
          <div style={{ marginTop: '1rem', overflowX: 'auto' }}>
            <table className="data-table" style={{ fontSize: '0.8rem' }}>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Status</th>
                  <th>Spend / Budget</th>
                  <th>Pace</th>
                  <th>Recommendation</th>
                </tr>
              </thead>
              <tbody>
                {pacing.campaigns.map((row) => (
                  <tr key={row.campaign_id}>
                    <td>{row.name}</td>
                    <td style={{ color: STATUS_COLOR[row.status] || 'inherit' }}>{row.status}</td>
                    <td>${row.spend?.toFixed?.(2) ?? row.spend} / ${row.budget?.toFixed?.(2) ?? row.budget}</td>
                    <td>{row.pace_ratio}x</td>
                    <td className="text-muted">{(row.recommendations || [])[0] || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Shuffle size={16} strokeWidth={2} />
          Dynamic budget reallocation
        </div>
        <p className="text-muted text-sm" style={{ marginTop: 0 }}>
          Shifts daily budget from lower performers to top campaigns. Apply updates local MongoDB budgets.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary" onClick={runReallocation} disabled={reallocLoading}>
            <RefreshCw size={14} className={reallocLoading ? 'spin' : undefined} />
            {reallocLoading ? 'Analyzing…' : 'Suggest reallocation'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => applyReallocation(false)}
            disabled={reallocApplyLoading || !reallocation?.shifts?.length}
          >
            {reallocApplyLoading ? 'Applying…' : 'Apply shifts locally'}
          </button>
        </div>
        {reallocation?.summary && (
          <p style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>{reallocation.summary}</p>
        )}
        {reallocation?.shifts?.length > 0 && (
          <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem', fontSize: '0.8rem' }}>
            {reallocation.shifts.map((s, i) => (
              <li key={i}>
                Move ${s.amount}/day from <strong>{s.from_name}</strong> → <strong>{s.to_name}</strong>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Link2 size={16} strokeWidth={2} />
          Lead attribution (multi-touch)
        </div>
        <p className="text-muted text-sm" style={{ marginTop: 0 }}>
          First-touch, last-touch, or linear credit across UTM journey touchpoints stored on lead capture.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            className="form-input"
            style={{ width: 'auto', minWidth: 140 }}
            value={attrModel}
            onChange={(e) => loadAttributionForModel(e.target.value)}
            disabled={attrLoading}
          >
            <option value="first_touch">First touch</option>
            <option value="last_touch">Last touch</option>
            <option value="linear">Linear</option>
          </select>
          <button type="button" className="btn btn-ghost btn-sm" onClick={refreshAttribution} disabled={attrLoading}>
          <RefreshCw size={14} className={attrLoading ? 'spin' : undefined} />
          Refresh
        </button>
        </div>
        {attribution && (
          <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <div>
              <div className="form-label">Total leads (90d)</div>
              <strong>{attribution.total_leads}</strong>
              {attribution.multi_touch_leads > 0 && (
                <div style={{ color: 'var(--fg-muted)', fontSize: '0.75rem' }}>
                  {attribution.multi_touch_leads} multi-touch
                </div>
              )}
            </div>
            <div>
              <div className="form-label">Top sources</div>
              <ul style={{ margin: 0, paddingLeft: '1rem' }}>
                {(attribution.by_source || []).slice(0, 4).map((r) => (
                  <li key={r.key}>{r.key}: {attrValue(r)}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="form-label">Top landing pages</div>
              <ul style={{ margin: 0, paddingLeft: '1rem' }}>
                {(attribution.by_landing_page || []).slice(0, 4).map((r) => (
                  <li key={r.key}>{r.key}: {attrValue(r)}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <TrendingDown size={16} strokeWidth={2} />
          Negative keywords (search query report)
        </div>
        <p className="text-muted text-sm" style={{ marginTop: 0 }}>
          Suggest negative keywords from search terms. Review before adding them to a campaign.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label className="form-label">Google Ads campaign</label>
            <select className="form-input" value={negCampaignId} onChange={(e) => setNegCampaignId(e.target.value)}>
              <option value="">— Select —</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <button type="button" className="btn btn-secondary" onClick={suggestNegatives} disabled={negLoading}>
            <Lightbulb size={14} />
            {negLoading ? 'Reviewing…' : 'Suggest negatives'}
          </button>
        </div>

        {recentNegatives.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <div className="form-label">Recent suggestions</div>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.8rem' }}>
              {recentNegatives.slice(0, 5).map((row) => (
                <li key={row.id} style={{ marginBottom: '0.35rem' }}>
                  {row.count} terms
                  {row.platform_campaign_id ? ` · campaign ${row.platform_campaign_id}` : ''}
                  {' · '}
                  {(row.suggestions || []).slice(0, 3).map((s) => (
                    typeof s === 'string' ? s : (s.keyword || s.text || JSON.stringify(s))
                  )).join(', ')}
                  {(row.suggestions || []).length > 3 ? '…' : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
