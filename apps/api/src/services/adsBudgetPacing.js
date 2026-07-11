/**
 * Budget pacing & KPI optimization — shared analysis for API, Beat, and dashboards.
 */
import { getDb } from '../lib/mongo.js'
import * as Campaign from '../models/Campaign.js'
import { publishEvent } from '../lib/events.js'

export function monthProgressUtc(now = new Date()) {
  const dayOfMonth = now.getUTCDate()
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
  return { dayOfMonth, daysInMonth, ratio: dayOfMonth / daysInMonth }
}

export function kpiIssues(metrics, targets = {}) {
  const issues = []
  const spend = Number(metrics?.spend || 0)
  const conversions = Number(metrics?.conversions || 0)
  const ctr = Number(metrics?.ctr || 0)
  const cpa = conversions > 0 ? spend / conversions : null
  const roas = Number(metrics?.roas || 0)

  if (targets.target_cpa != null && cpa != null && cpa > Number(targets.target_cpa)) {
    issues.push({
      type: 'cpa_above_target',
      priority: 'high',
      message: `CPA $${cpa.toFixed(2)} exceeds target $${Number(targets.target_cpa).toFixed(2)}`,
    })
  }
  if (targets.target_roas != null && roas > 0 && roas < Number(targets.target_roas)) {
    issues.push({
      type: 'roas_below_target',
      priority: 'high',
      message: `ROAS ${roas.toFixed(2)} is below target ${Number(targets.target_roas).toFixed(2)}`,
    })
  }
  if (ctr > 0 && ctr < 1.5) {
    issues.push({
      type: 'low_ctr',
      priority: 'medium',
      message: 'CTR is low — test new RSA headlines/descriptions.',
    })
  }
  if (conversions === 0 && spend > 0) {
    issues.push({
      type: 'no_conversions',
      priority: 'high',
      message: 'No conversions yet — review landing page and targeting.',
    })
  }
  return issues
}

export function analyzeCampaignPacing(campaign, { monthProgress, targets = {} }) {
  const budget = Number(campaign.budget?.amount || 0)
  const spend = Number(campaign.metrics?.spend || 0)
  const expectedSpend = budget > 0 ? budget * monthProgress : 0
  const paceRatio = expectedSpend > 0 ? spend / expectedSpend : (spend > 0 ? 2 : 0)

  let status = 'on_track'
  const recommendations = []

  if (budget > 0 && paceRatio > 1.15) {
    status = 'overspending'
    recommendations.push('Reduce daily budget or pause low-performing ad groups.')
  } else if (budget > 0 && paceRatio < 0.7 && spend > 0) {
    status = 'underspending'
    recommendations.push('Increase bids or expand keywords to use allocated budget.')
  }

  const kpi = kpiIssues(campaign.metrics || {}, targets)
  for (const issue of kpi) {
    recommendations.push(issue.message)
  }
  if (!recommendations.length) {
    recommendations.push('Performance looks stable — monitor weekly.')
  }

  return {
    campaign_id: campaign._id?.toString() || campaign.id,
    name: campaign.name,
    platform: campaign.platform,
    budget,
    spend,
    spend_pct: budget > 0 ? Math.round((spend / budget) * 1000) / 10 : null,
    expected_spend_to_date: Math.round(expectedSpend * 100) / 100,
    pace_ratio: Math.round(paceRatio * 100) / 100,
    status,
    metrics: {
      ctr: campaign.metrics?.ctr ?? 0,
      cpc: campaign.metrics?.cpc ?? 0,
      conversions: campaign.metrics?.conversions ?? 0,
      roas: campaign.metrics?.roas ?? 0,
    },
    kpi_issues: kpi,
    recommendations,
    auto_actions: status === 'overspending' && kpi.some((i) => i.priority === 'high')
      ? ['pause_campaign_locally']
      : [],
  }
}

export function analyzeWorkspacePacing(campaigns, { targets = {}, now = new Date() } = {}) {
  const { ratio: monthProgress } = monthProgressUtc(now)
  const pacing = (campaigns || []).map((c) => analyzeCampaignPacing(c, { monthProgress, targets }))

  return {
    analyzed_at: now.toISOString(),
    month_progress_pct: Math.round(monthProgress * 1000) / 10,
    targets: targets || {},
    campaigns: pacing,
    summary: {
      overspending: pacing.filter((p) => p.status === 'overspending').length,
      underspending: pacing.filter((p) => p.status === 'underspending').length,
      on_track: pacing.filter((p) => p.status === 'on_track').length,
      kpi_alerts: pacing.filter((p) => (p.kpi_issues || []).length > 0).length,
    },
  }
}

export async function persistPacingSnapshot(workspaceId, result) {
  const doc = {
    workspace_id: workspaceId,
    kind: 'pacing_run',
    analyzed_at: result.analyzed_at ? new Date(result.analyzed_at) : new Date(),
    summary: result.summary,
    targets: result.targets,
    campaign_count: (result.campaigns || []).length,
    created_at: new Date(),
  }
  await getDb().collection('ads_metrics').insertOne(doc)
  return doc
}

/**
 * Run pacing for a workspace; optionally pause overspending campaigns locally and emit events.
 */
export async function runWorkspacePacing(workspaceId, {
  targets = {},
  persist = true,
  auto_pause_overspend: autoPause = false,
} = {}) {
  const { items } = await Campaign.findAll(workspaceId, { per_page: 1000 })
  const result = analyzeWorkspacePacing(items, { targets })
  const actions = []

  if (autoPause) {
    for (const row of result.campaigns) {
      if (!row.auto_actions?.includes('pause_campaign_locally')) continue
      const c = items.find((x) => x._id.toString() === row.campaign_id)
      if (!c || c.status === 'paused') continue
      await Campaign.updateCampaign(c._id.toString(), { status: 'paused' })
      actions.push({ campaign_id: row.campaign_id, action: 'paused_locally', reason: 'overspending+kpi' })
    }
  }

  if (persist) {
    await persistPacingSnapshot(workspaceId, result)
  }

  await publishEvent('budget.pacing_analyzed', {
    workspace_id: workspaceId,
    summary: result.summary,
    actions_taken: actions.length,
  })

  return { ...result, actions_taken: actions }
}

/** Hourly Beat: all workspaces with active/paused budgeted campaigns. */
export async function runHourlyPacingForAllWorkspaces({ auto_pause_overspend = false } = {}) {
  const db = getDb()
  const workspaceIds = await db.collection('ads_campaigns').distinct('workspace_id', {
    deleted_at: null,
    'budget.amount': { $gt: 0 },
  })

  const outputs = []
  for (const wid of workspaceIds) {
    if (!wid) continue
    try {
      const out = await runWorkspacePacing(String(wid), {
        persist: true,
        auto_pause_overspend: auto_pause_overspend,
      })
      outputs.push({ workspace_id: String(wid), summary: out.summary, actions: out.actions_taken })
    } catch (err) {
      outputs.push({ workspace_id: String(wid), error: err.message })
    }
  }
  return { workspaces: outputs.length, results: outputs }
}

/**
 * ONBOARDING §9.4 — dynamic budget allocation recommendations (read-only; no auto-mutate).
 */
export function recommendBudgetReallocation(campaigns, { target_cpa: targetCpa, target_roas: targetRoas } = {}) {
  const active = (campaigns || []).filter((c) => Number(c.budget?.amount || 0) > 0)
  if (active.length < 2) {
    return { shifts: [], summary: 'Need at least two budgeted campaigns to suggest reallocation.' }
  }

  const scored = active.map((c) => {
    const spend = Number(c.metrics?.spend || 0)
    const conv = Number(c.metrics?.conversions || 0)
    const roas = Number(c.metrics?.roas || 0)
    const cpa = conv > 0 ? spend / conv : null
    let score = conv > 0 ? conv / Math.max(spend, 1) : 0
    if (targetRoas != null && roas > 0) score += roas / Number(targetRoas)
    if (targetCpa != null && cpa != null && cpa <= Number(targetCpa)) score += 1
    if (spend === 0) score = 0
    return {
      campaign_id: c._id?.toString() || c.id,
      name: c.name,
      platform: c.platform,
      budget: Number(c.budget?.amount || 0),
      spend,
      score,
      cpa,
      roas,
    }
  }).sort((a, b) => b.score - a.score)

  const top = scored[0]
  const bottom = scored[scored.length - 1]
  if (!top || !bottom || top.campaign_id === bottom.campaign_id) {
    return { shifts: [], summary: 'Insufficient performance spread for reallocation.' }
  }

  const shiftAmount = Math.min(
    Math.round(bottom.budget * 0.15),
    Math.round(top.budget * 0.25),
    50,
  )
  if (shiftAmount < 5) {
    return { shifts: [], summary: 'Budget amounts too small for a meaningful shift.' }
  }

  const shifts = [
    {
      from_campaign_id: bottom.campaign_id,
      from_name: bottom.name,
      to_campaign_id: top.campaign_id,
      to_name: top.name,
      amount: shiftAmount,
      reason: `Shift daily budget from lower performer (score ${bottom.score.toFixed(3)}) to top performer (score ${top.score.toFixed(3)}).`,
    },
  ]

  return {
    shifts,
    ranked: scored,
    summary: `Suggest moving $${shiftAmount}/day from "${bottom.name}" to "${top.name}".`,
  }
}

export async function runWorkspaceBudgetReallocation(workspaceId, options = {}) {
  const { items } = await Campaign.findAll(workspaceId, { per_page: 1000 })
  const result = recommendBudgetReallocation(items, options)
  await getDb().collection('ads_metrics').insertOne({
    workspace_id: workspaceId,
    kind: 'budget_reallocation_run',
    shifts: result.shifts,
    summary: result.summary,
    created_at: new Date(),
  })
  await publishEvent('budget.reallocation_analyzed', {
    workspace_id: workspaceId,
    shift_count: result.shifts.length,
  })
  return result
}

/** Apply reallocation shifts to local campaign budgets (MongoDB only). */
export async function applyBudgetReallocation(workspaceId, shifts, { dry_run: dryRun = false } = {}) {
  const applied = []
  for (const shift of shifts || []) {
    const fromId = shift.from_campaign_id
    const toId = shift.to_campaign_id
    if (!fromId || !toId) continue
    const from = await Campaign.findById(fromId, workspaceId)
    const to = await Campaign.findById(toId, workspaceId)
    if (!from || !to) continue
    const amount = Number(shift.amount || 0)
    if (amount <= 0) continue
    const fromBudget = Number(from.budget?.amount || 0)
    const toBudget = Number(to.budget?.amount || 0)
    if (fromBudget < amount) continue
    const fromNew = Math.round((fromBudget - amount) * 100) / 100
    const toNew = Math.round((toBudget + amount) * 100) / 100
    if (!dryRun) {
      await Campaign.updateCampaign(from._id.toString(), {
        budget: { ...from.budget, amount: fromNew },
      })
      await Campaign.updateCampaign(to._id.toString(), {
        budget: { ...to.budget, amount: toNew },
      })
    }
    applied.push({
      ...shift,
      from_new_budget: fromNew,
      to_new_budget: toNew,
    })
  }
  if (!dryRun && applied.length) {
    await getDb().collection('ads_metrics').insertOne({
      workspace_id: workspaceId,
      kind: 'budget_reallocation_applied',
      shifts: applied,
      created_at: new Date(),
    })
    await publishEvent('budget.reallocation_applied', {
      workspace_id: workspaceId,
      shift_count: applied.length,
    })
  }
  return { applied, dry_run: dryRun }
}
