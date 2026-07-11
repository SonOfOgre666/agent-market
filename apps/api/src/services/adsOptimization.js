/**
 * SEA optimization — bid CPA/ROAS loop, asset A/B analysis, quality score monitoring.
 * Reuses adsBudgetPacing KPI helpers, Google reporting (worker), and ads tool mutations.
 */
import { ObjectId } from 'mongodb'
import { getDb } from '../lib/mongo.js'
import * as Campaign from '../models/Campaign.js'
import * as Account from '../models/Account.js'
import { enqueueCeleryAndWaitForJson } from '../lib/p2ExecCeleryReply.js'
import { enrichAdsToolPayload } from '../lib/adsToolPayload.js'
import { publishEvent } from '../lib/events.js'
import { kpiIssues, analyzeCampaignPacing, monthProgressUtc } from './adsBudgetPacing.js'

async function resolveGoogleAdsAccountId(workspaceId, explicitAccountId) {
  if (explicitAccountId) return String(explicitAccountId)
  const accounts = await Account.findAll(workspaceId, { kind: 'ads' })
  const google = accounts.filter((a) => a.provider === 'google_ads' && a.authorized !== false)
  if (google.length === 1) return String(google[0]._id)
  return null
}

async function fetchGoogleReporting(workspaceId, accountId, operation, payload) {
  const json = await enqueueCeleryAndWaitForJson(
    'tasks.ads.google_ads_reporting_read',
    [String(workspaceId), String(accountId), operation, payload || {}],
    { timeoutMs: 120000 },
  )
  if (!json.ok) {
    throw Object.assign(new Error(json.error || 'Google Ads reporting failed'), {
      statusCode: Number(json.status) || 502,
    })
  }
  const data = json.data || {}
  if (data.response_type === 'object') return data.payload || {}
  return data.payload || []
}

async function executeAdsTool(workspaceId, toolId, payload) {
  const enriched = await enrichAdsToolPayload(workspaceId, toolId, payload)
  const json = await enqueueCeleryAndWaitForJson(
    'tasks.ads.execute_ads_tool',
    [toolId, enriched],
    { timeoutMs: 120000 },
  )
  if (!json.ok) {
    throw Object.assign(new Error(json.error || `${toolId} failed`), {
      statusCode: Number(json.status) || 422,
    })
  }
  return json.data || {}
}

function campaignBidRecommendations(campaign, targets = {}) {
  const metrics = campaign.metrics || {}
  const spend = Number(metrics.spend || 0)
  const conversions = Number(metrics.conversions || 0)
  const cpa = conversions > 0 ? spend / conversions : null
  const roas = Number(metrics.roas || 0)
  const issues = kpiIssues(metrics, targets)
  const recs = []

  for (const issue of issues) {
    if (issue.type === 'cpa_above_target') {
      recs.push({
        level: 'campaign',
        campaign_id: campaign._id?.toString(),
        campaign_name: campaign.name,
        action: 'decrease_bids',
        factor: 0.9,
        reason: issue.message,
        priority: 'high',
      })
    }
    if (issue.type === 'roas_below_target') {
      recs.push({
        level: 'campaign',
        campaign_id: campaign._id?.toString(),
        campaign_name: campaign.name,
        action: 'decrease_bids',
        factor: 0.92,
        reason: issue.message,
        priority: 'high',
      })
    }
    if (issue.type === 'low_ctr') {
      recs.push({
        level: 'campaign',
        campaign_id: campaign._id?.toString(),
        campaign_name: campaign.name,
        action: 'test_creative',
        reason: issue.message,
        priority: 'medium',
      })
    }
  }

  if (
    targets.target_cpa != null
    && cpa != null
    && cpa < Number(targets.target_cpa) * 0.75
    && conversions >= 3
  ) {
    recs.push({
      level: 'campaign',
      campaign_id: campaign._id?.toString(),
      campaign_name: campaign.name,
      action: 'increase_bids',
      factor: 1.1,
      reason: `CPA $${cpa.toFixed(2)} is well below target $${Number(targets.target_cpa).toFixed(2)} with ${conversions} conversions`,
      priority: 'medium',
    })
  }
  if (
    targets.target_roas != null
    && roas > 0
    && roas >= Number(targets.target_roas) * 1.2
    && spend > 20
  ) {
    recs.push({
      level: 'campaign',
      campaign_id: campaign._id?.toString(),
      campaign_name: campaign.name,
      action: 'increase_bids',
      factor: 1.08,
      reason: `ROAS ${roas.toFixed(2)} exceeds target ${Number(targets.target_roas).toFixed(2)}`,
      priority: 'medium',
    })
  }

  return recs
}

function keywordBidRecommendation(keyword, targets = {}) {
  const spend = Number(keyword.cost || 0)
  const conversions = Number(keyword.conversions || 0)
  const impressions = Number(keyword.impressions || 0)
  const cpa = conversions > 0 ? spend / conversions : null
  const currentCpc = Number(keyword.average_cpc || 0)
  if (impressions < 50 || currentCpc <= 0) return null

  const targetCpa = targets.target_cpa != null ? Number(targets.target_cpa) : null
  let action = null
  let factor = 1
  let reason = null

  if (targetCpa != null && cpa != null && cpa > targetCpa * 1.15 && spend >= 10) {
    action = 'decrease'
    factor = 0.9
    reason = `Keyword CPA $${cpa.toFixed(2)} above target $${targetCpa.toFixed(2)}`
  } else if (targetCpa != null && cpa != null && cpa < targetCpa * 0.7 && conversions >= 2) {
    action = 'increase'
    factor = 1.1
    reason = `Keyword CPA $${cpa.toFixed(2)} below target with steady conversions`
  } else if (conversions === 0 && spend >= 25) {
    action = 'decrease'
    factor = 0.85
    reason = `No conversions after $${spend.toFixed(2)} spend`
  }

  if (!action) return null

  const suggestedCpc = Math.max(0.01, Math.round(currentCpc * factor * 10000) / 10000)
  return {
    level: 'keyword',
    keyword_id: keyword.keyword_id,
    keyword_text: keyword.keyword_text,
    ad_group_id: keyword.ad_group_id,
    campaign_id: keyword.campaign_id,
    campaign_name: keyword.campaign_name,
    action,
    current_cpc: currentCpc,
    suggested_cpc: suggestedCpc,
    cpc_bid_micros: Math.round(suggestedCpc * 1_000_000),
    reason,
    priority: action === 'decrease' && conversions === 0 ? 'high' : 'medium',
  }
}

export function analyzeQualityScoresFromKeywords(keywords) {
  const withQs = (keywords || []).filter((k) => k.quality_score != null && k.quality_score > 0)
  const avg = withQs.length
    ? withQs.reduce((s, k) => s + Number(k.quality_score), 0) / withQs.length
    : null
  const low = withQs.filter((k) => Number(k.quality_score) <= 4)
  const mid = withQs.filter((k) => {
    const q = Number(k.quality_score)
    return q >= 5 && q <= 6
  })
  const high = withQs.filter((k) => Number(k.quality_score) >= 7)

  const recommendations = []
  for (const kw of [...low, ...mid].sort((a, b) => Number(a.quality_score) - Number(b.quality_score)).slice(0, 25)) {
    const qs = Number(kw.quality_score)
    recommendations.push({
      keyword_id: kw.keyword_id,
      keyword_text: kw.keyword_text,
      quality_score: qs,
      campaign_id: kw.campaign_id,
      campaign_name: kw.campaign_name,
      ad_group_name: kw.ad_group_name,
      impressions: kw.impressions,
      priority: qs <= 4 ? 'high' : 'medium',
      message: qs <= 4
        ? `Critical QS ${qs} — tighten ad group theme, improve landing page relevance, and test new RSA headlines for "${kw.keyword_text}"`
        : `QS ${qs} — add keyword-specific headlines and review search terms for "${kw.keyword_text}"`,
    })
  }

  return {
    summary: {
      keywords_with_score: withQs.length,
      average_quality_score: avg != null ? Math.round(avg * 10) / 10 : null,
      low: low.length,
      medium: mid.length,
      high: high.length,
    },
    recommendations,
    flagged_keywords: low.concat(mid).slice(0, 40),
  }
}

export function analyzeAssetAbTestsFromAds(ads, { min_impressions: minImpressions = 200, min_uplift_pct: minUplift = 10 } = {}) {
  const byGroup = new Map()
  for (const ad of ads || []) {
    const gid = ad.ad_group_id
    if (!gid) continue
    if (!byGroup.has(gid)) byGroup.set(gid, [])
    byGroup.get(gid).push(ad)
  }

  const experiments = []
  for (const [adGroupId, groupAds] of byGroup) {
    const eligible = groupAds.filter((a) => Number(a.impressions || 0) >= minImpressions)
    if (eligible.length < 2) continue

    const scored = eligible.map((a) => {
      const cost = Math.max(Number(a.cost || 0), 0.01)
      const conversions = Number(a.conversions || 0)
      const ctr = Number(a.ctr || 0)
      const score = conversions > 0 ? conversions / cost : ctr
      return { ...a, score }
    }).sort((a, b) => b.score - a.score)

    const winner = scored[0]
    const loser = scored[scored.length - 1]
    if (!winner || !loser || winner.ad_id === loser.ad_id) continue

    const uplift = loser.score > 0
      ? ((winner.score - loser.score) / loser.score) * 100
      : (winner.score > 0 ? 100 : 0)
    if (uplift < minUplift) continue

    experiments.push({
      ad_group_id: adGroupId,
      ad_group_name: winner.ad_group_name,
      campaign_id: winner.campaign_id,
      campaign_name: winner.campaign_name,
      winner: {
        ad_id: winner.ad_id,
        ad_type: winner.ad_type,
        score: Math.round(winner.score * 1000) / 1000,
        ctr: winner.ctr,
        conversions: winner.conversions,
        cost: winner.cost,
      },
      loser: {
        ad_id: loser.ad_id,
        ad_type: loser.ad_type,
        score: Math.round(loser.score * 1000) / 1000,
        ctr: loser.ctr,
        conversions: loser.conversions,
        cost: loser.cost,
      },
      uplift_pct: Math.round(uplift),
      recommendation: `Pause underperforming ad ${loser.ad_id} (${loser.ad_type || 'ad'}) — winner ${winner.ad_id} leads by ${Math.round(uplift)}%`,
      action: 'pause_ad',
    })
  }

  return {
    experiments,
    summary: {
      ad_groups_analyzed: byGroup.size,
      experiments_found: experiments.length,
    },
  }
}

export async function runBidOptimization(workspaceId, {
  target_cpa: targetCpa,
  target_roas: targetRoas,
  account_id: accountId,
  campaign_id: campaignId,
  date_range: dateRange = 'LAST_30_DAYS',
  include_keywords: includeKeywords = true,
  persist = true,
} = {}) {
  const targets = {
    target_cpa: targetCpa != null ? Number(targetCpa) : undefined,
    target_roas: targetRoas != null ? Number(targetRoas) : undefined,
  }

  const filter = { per_page: 1000, platform: 'google_ads' }
  const { items: campaigns } = await Campaign.findAll(workspaceId, filter)
  const scoped = campaignId
    ? campaigns.filter((c) => c._id.toString() === campaignId || c.uuid === campaignId)
    : campaigns.filter((c) => c.status === 'active' || Number(c.metrics?.spend || 0) > 0)

  const campaignRecs = scoped.flatMap((c) => campaignBidRecommendations(c, targets))
  const keywordRecs = []
  let keywordsAnalyzed = 0
  const reportingErrors = []

  if (includeKeywords && scoped.some((c) => c.platform_campaign_id)) {
    const resolvedAccountId = await resolveGoogleAdsAccountId(workspaceId, accountId)
    if (resolvedAccountId) {
      for (const c of scoped) {
        if (!c.platform_campaign_id) continue
        try {
          const keywords = await fetchGoogleReporting(workspaceId, resolvedAccountId, 'keywords', {
            date_range: dateRange,
            campaign_id: String(c.platform_campaign_id),
            min_impressions: 50,
          })
          const list = Array.isArray(keywords) ? keywords : []
          keywordsAnalyzed += list.length
          for (const kw of list) {
            const rec = keywordBidRecommendation(kw, targets)
            if (rec) {
              rec.local_campaign_id = c._id.toString()
              rec.account_id = c.account_id || c.ad_account_id || resolvedAccountId
              keywordRecs.push(rec)
            }
          }
        } catch (err) {
          reportingErrors.push({ campaign_id: c._id.toString(), error: err.message })
        }
      }
    }
  }

  const result = {
    analyzed_at: new Date().toISOString(),
    targets,
    date_range: dateRange,
    campaign_recommendations: campaignRecs,
    keyword_recommendations: keywordRecs,
    summary: {
      campaigns_analyzed: scoped.length,
      keywords_analyzed: keywordsAnalyzed,
      campaign_actions: campaignRecs.length,
      keyword_actions: keywordRecs.length,
      reporting_errors: reportingErrors.length,
    },
    reporting_errors: reportingErrors,
  }

  if (persist) {
    await getDb().collection('ads_metrics').insertOne({
      workspace_id: workspaceId,
      kind: 'bid_optimization_run',
      ...result,
      created_at: new Date(),
    })
  }

  await publishEvent('ads.bid_optimization_analyzed', {
    workspace_id: workspaceId,
    keyword_actions: keywordRecs.length,
    campaign_actions: campaignRecs.length,
  })

  return result
}

export async function applyBidRecommendations(workspaceId, {
  keyword_recommendations: keywordRecs,
  dry_run: dryRun = false,
  max_applies: maxApplies = 15,
} = {}) {
  const applied = []
  const skipped = []
  const list = (keywordRecs || []).slice(0, maxApplies)

  for (const rec of list) {
    if (rec.level !== 'keyword' || !rec.ad_group_id || !rec.keyword_id || !rec.cpc_bid_micros) {
      skipped.push({ ...rec, reason: 'incomplete_keyword_recommendation' })
      continue
    }
    if (dryRun) {
      applied.push({ ...rec, dry_run: true })
      continue
    }
    try {
      await executeAdsTool(workspaceId, 'google_update_keyword_bid', {
        account_id: rec.account_id,
        ad_group_id: String(rec.ad_group_id),
        keyword_id: String(rec.keyword_id),
        cpc_bid_micros: rec.cpc_bid_micros,
      })
      applied.push(rec)
    } catch (err) {
      skipped.push({ ...rec, reason: err.message })
    }
  }

  if (!dryRun && applied.length) {
    await getDb().collection('ads_metrics').insertOne({
      workspace_id: workspaceId,
      kind: 'bid_optimization_applied',
      applied_count: applied.length,
      skipped_count: skipped.length,
      created_at: new Date(),
    })
    await publishEvent('ads.bid_optimization_applied', {
      workspace_id: workspaceId,
      applied: applied.length,
      skipped: skipped.length,
    })
  }

  return { applied, skipped, dry_run: dryRun }
}

export async function runQualityScoreMonitor(workspaceId, {
  account_id: accountId,
  campaign_id: platformCampaignId,
  date_range: dateRange = 'LAST_30_DAYS',
  persist = true,
} = {}) {
  const resolvedAccountId = await resolveGoogleAdsAccountId(workspaceId, accountId)
  if (!resolvedAccountId) {
    throw Object.assign(new Error('No connected Google Ads account'), { statusCode: 422 })
  }

  const keywords = await fetchGoogleReporting(workspaceId, resolvedAccountId, 'keywords', {
    date_range: dateRange,
    campaign_id: platformCampaignId || null,
    min_impressions: 10,
  })
  const list = Array.isArray(keywords) ? keywords : []
  const result = {
    analyzed_at: new Date().toISOString(),
    date_range: dateRange,
    account_id: resolvedAccountId,
    ...analyzeQualityScoresFromKeywords(list),
  }

  if (persist) {
    await getDb().collection('ads_metrics').insertOne({
      workspace_id: workspaceId,
      kind: 'quality_score_snapshot',
      ...result,
      created_at: new Date(),
    })
  }

  await publishEvent('ads.quality_score_analyzed', {
    workspace_id: workspaceId,
    flagged: result.summary?.low + result.summary?.medium,
  })

  return result
}

export async function runAssetAbTestAnalysis(workspaceId, {
  account_id: accountId,
  campaign_id: platformCampaignId,
  date_range: dateRange = 'LAST_30_DAYS',
  min_impressions: minImpressions = 200,
  persist = true,
} = {}) {
  const resolvedAccountId = await resolveGoogleAdsAccountId(workspaceId, accountId)
  if (!resolvedAccountId) {
    throw Object.assign(new Error('No connected Google Ads account'), { statusCode: 422 })
  }

  const ads = await fetchGoogleReporting(workspaceId, resolvedAccountId, 'ads', {
    date_range: dateRange,
    campaign_id: platformCampaignId || null,
  })
  const list = Array.isArray(ads) ? ads : []
  const analysis = analyzeAssetAbTestsFromAds(list, { min_impressions: minImpressions })
  const result = {
    analyzed_at: new Date().toISOString(),
    date_range: dateRange,
    account_id: resolvedAccountId,
    ...analysis,
  }

  if (persist) {
    await getDb().collection('ads_metrics').insertOne({
      workspace_id: workspaceId,
      kind: 'asset_ab_analysis',
      ...result,
      created_at: new Date(),
    })
  }

  await publishEvent('ads.asset_ab_analyzed', {
    workspace_id: workspaceId,
    experiments: analysis.summary?.experiments_found || 0,
  })

  return result
}

export async function applyAssetAbRecommendations(workspaceId, {
  experiments,
  dry_run: dryRun = false,
  max_applies: maxApplies = 10,
} = {}) {
  const applied = []
  const skipped = []
  const resolvedAccountId = await resolveGoogleAdsAccountId(workspaceId)

  for (const exp of (experiments || []).slice(0, maxApplies)) {
    const loserAdId = exp?.loser?.ad_id
    const adGroupId = exp?.ad_group_id
    if (!loserAdId || !adGroupId) {
      skipped.push({ ...exp, reason: 'incomplete_experiment' })
      continue
    }
    if (dryRun) {
      applied.push({ ad_id: loserAdId, ad_group_id: adGroupId, action: 'pause_ad', dry_run: true })
      continue
    }
    try {
      await executeAdsTool(workspaceId, 'google_pause_ad', {
        account_id: resolvedAccountId,
        ad_group_id: String(adGroupId),
        ad_id: String(loserAdId),
      })
      applied.push({ ad_id: loserAdId, ad_group_id: adGroupId, action: 'pause_ad' })
    } catch (err) {
      skipped.push({ ad_id: loserAdId, reason: err.message })
    }
  }

  if (!dryRun && applied.length) {
    await publishEvent('ads.asset_ab_applied', {
      workspace_id: workspaceId,
      paused_ads: applied.length,
    })
  }

  return { applied, skipped, dry_run: dryRun }
}

/** Closed-loop Beat: analyze all workspaces; optionally auto-apply safe bid decreases. */
export async function runHourlyBidOptimizationForAllWorkspaces({
  auto_apply: autoApply = false,
  target_cpa: targetCpa,
  target_roas: targetRoas,
} = {}) {
  const db = getDb()
  const workspaceIds = await db.collection('ads_campaigns').distinct('workspace_id', {
    deleted_at: null,
    platform: 'google_ads',
    status: 'active',
  })

  const outputs = []
  for (const wid of workspaceIds) {
    if (!wid) continue
    try {
      const analysis = await runBidOptimization(String(wid), {
        target_cpa: targetCpa,
        target_roas: targetRoas,
        persist: true,
      })
      let applyOut = null
      if (autoApply && analysis.keyword_recommendations?.length) {
        const safe = analysis.keyword_recommendations.filter(
          (r) => r.action === 'decrease' && r.priority === 'high',
        )
        applyOut = await applyBidRecommendations(String(wid), {
          keyword_recommendations: safe,
          dry_run: false,
          max_applies: 10,
        })
      }
      outputs.push({
        workspace_id: String(wid),
        summary: analysis.summary,
        auto_applied: applyOut?.applied?.length || 0,
      })
    } catch (err) {
      outputs.push({ workspace_id: String(wid), error: err.message })
    }
  }
  return { workspaces: outputs.length, results: outputs }
}

function bidRecToSuggestion(rec) {
  const typeMap = {
    decrease_bids: 'bid',
    increase_bids: 'bid',
    test_creative: 'headline',
  }
  return {
    type: typeMap[rec.action] || 'general',
    priority: rec.priority || 'medium',
    suggestion: rec.reason,
    action: rec.action,
    factor: rec.factor,
  }
}

function kpiToSuggestion(issue) {
  const typeMap = {
    cpa_above_target: 'bid',
    roas_below_target: 'bid',
    low_ctr: 'headline',
    no_conversions: 'landing_page',
  }
  return {
    type: typeMap[issue.type] || 'general',
    priority: issue.priority,
    suggestion: issue.message,
  }
}

/**
 * Canonical campaign optimization — used by Celery Beat, UI optimize button, and agent.
 * Reuses KPI pacing + bid recommendation logic from the budget panel services.
 */
export async function runCampaignOptimization(campaignId, {
  target_cpa: targetCpa,
  target_roas: targetRoas,
  include_keywords: includeKeywords = true,
  persist = true,
} = {}) {
  let oid
  try {
    oid = new ObjectId(campaignId)
  } catch {
    throw Object.assign(new Error('Invalid campaign id'), { statusCode: 400 })
  }

  const c = await getDb().collection('ads_campaigns').findOne({ _id: oid, deleted_at: null })
  if (!c) throw Object.assign(new Error('Campaign not found'), { statusCode: 404 })

  const workspaceId = String(c.workspace_id)
  const targets = {
    target_cpa: targetCpa != null ? Number(targetCpa) : undefined,
    target_roas: targetRoas != null ? Number(targetRoas) : undefined,
  }

  const pacing = analyzeCampaignPacing(c, { monthProgress: monthProgressUtc(), targets })
  const campaignRecs = campaignBidRecommendations(c, targets)

  const suggestions = []
  const seen = new Set()
  const push = (s) => {
    const key = `${s.type}:${s.suggestion}`
    if (seen.has(key)) return
    seen.add(key)
    suggestions.push(s)
  }

  for (const issue of pacing.kpi_issues || []) push(kpiToSuggestion(issue))
  for (const rec of campaignRecs) push(bidRecToSuggestion(rec))
  for (const msg of pacing.recommendations || []) {
    if (/stable|monitor/i.test(msg)) continue
    push({
      type: pacing.status === 'overspending' ? 'budget' : 'general',
      priority: pacing.status === 'overspending' ? 'high' : 'medium',
      suggestion: msg,
    })
  }

  let bidAnalysis = null
  if (includeKeywords) {
    try {
      bidAnalysis = await runBidOptimization(workspaceId, {
        campaign_id: campaignId,
        target_cpa: targets.target_cpa,
        target_roas: targets.target_roas,
        include_keywords: true,
        persist: false,
      })
      for (const rec of bidAnalysis.keyword_recommendations || []) {
        push({
          type: 'bid',
          priority: rec.priority || 'medium',
          suggestion: rec.reason,
          level: 'keyword',
          keyword_text: rec.keyword_text,
        })
      }
    } catch {
      // Non-fatal when Google reporting is unavailable.
    }
  }

  if (!suggestions.length) {
    push({
      type: 'general',
      priority: 'low',
      suggestion: `Campaign ${c.name} looks stable. Consider scaling budget gradually.`,
    })
  }

  const optimization = {
    suggestions,
    pacing_status: pacing.status,
    campaign_recommendations: campaignRecs,
    optimizedAt: new Date().toISOString(),
  }

  const now = new Date()
  await getDb().collection('ads_campaigns').updateOne(
    { _id: oid },
    { $set: { optimization, updated_at: now } },
  )

  const metrics = c.metrics || {}
  if (persist) {
    await getDb().collection('ads_metrics').insertOne({
      campaign_id: campaignId,
      workspace_id: workspaceId,
      platform: c.platform,
      name: c.name,
      ctr: metrics.ctr || 0,
      cpc: metrics.cpc || 0,
      cpa: metrics.cpa || 0,
      roas: metrics.roas || 0,
      spend: metrics.spend || 0,
      impressions: metrics.impressions || 0,
      clicks: metrics.clicks || 0,
      conversions: metrics.conversions || 0,
      suggestions_count: suggestions.length,
      recorded_at: now,
    })
  }

  await publishEvent('campaign.optimized', {
    campaignId,
    suggestions_count: suggestions.length,
  })

  return { ok: true, suggestions, optimization, bid_analysis: bidAnalysis, pacing }
}
