/**
 * Shared workspace KPI aggregates — weekly email, PDF export, internal Beat.
 */
import { getDb } from '../lib/mongo.js'
import * as Campaign from '../models/Campaign.js'
import { aggregateBudgetTotals, BUDGET_PLATFORM_META } from '../lib/campaignPlatforms.js'
import { summarizeLeadAttribution } from './leadAttribution.js'
import { countWorkspacePostActivity } from './dashboardOverview.js'

export async function buildWorkspaceKpiStats(workspaceId, { since = null, days = null } = {}) {
  const sinceDate = since
    ? new Date(since)
    : new Date(Date.now() - (Number(days) || 7) * 86400000)

  const { items } = await Campaign.findAll(workspaceId, { per_page: 1000 })
  const budget = aggregateBudgetTotals(items)
  const { posts_published, posts_scheduled } = await countWorkspacePostActivity(workspaceId, {
    since: sinceDate,
  })
  const periodDays = Math.max(1, Math.ceil((Date.now() - sinceDate.getTime()) / 86400000))
  const attribution = await summarizeLeadAttribution(workspaceId, {
    days: periodDays,
    model: 'linear',
  })

  return {
    ...budget,
    posts_published,
    posts_scheduled,
    leads_in_period: attribution.total_leads,
    attribution_top_sources: attribution.by_source.slice(0, 5),
    attribution_model: attribution.model,
    period_days: periodDays,
    period_start: sinceDate.toISOString(),
    period_end: new Date().toISOString(),
  }
}

export async function buildWeeklyReportSnapshots() {
  const db = getDb()
  const now = new Date()
  const weekAgo = new Date(now.getTime() - 7 * 86400000)
  const weekLabel = `${weekAgo.toLocaleString('en-US', { month: 'short', day: 'numeric' })} – ${now.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
  const workspaces = await db.collection('workspaces').find({ deleted_at: null }).toArray()
  const reports = []

  for (const ws of workspaces) {
    const wid = String(ws._id)
    const stats = await buildWorkspaceKpiStats(wid, { since: weekAgo })
    const memberIds = (ws.members || []).map((m) => m.user_id).filter(Boolean)
    const { ObjectId } = await import('mongodb')
    const oids = []
    for (const uid of memberIds) {
      try {
        oids.push(new ObjectId(uid))
      } catch {
        /* skip */
      }
    }
    const users = oids.length
      ? await db.collection('users').find({ _id: { $in: oids } }).toArray()
      : []
    const emails = users.map((u) => u.email).filter(Boolean)
    if (!emails.length) continue

    reports.push({
      workspace_id: wid,
      workspace_name: ws.name || 'Your Workspace',
      emails,
      stats: {
        total_budget: stats.total_budget,
        total_spend: stats.total_spend,
        budget_remaining: stats.budget_remaining,
        total_impressions: stats.total_impressions,
        total_clicks: stats.total_clicks,
        ctr: stats.ctr,
        cpc: stats.cpc,
        total_conversions: stats.total_conversions,
        cpa: stats.cpa,
        active_campaigns: stats.active_campaigns,
        posts_published: stats.posts_published,
        posts_scheduled: stats.posts_scheduled,
        leads_this_week: stats.leads_in_period,
        attribution_top_sources: stats.attribution_top_sources,
        attribution_model: stats.attribution_model,
        by_platform: stats.by_platform,
      },
      week_label: weekLabel,
    })
  }

  return {
    week_ago: weekAgo.toISOString(),
    now: now.toISOString(),
    week_label: weekLabel,
    reports,
  }
}

/** Minimal PDF (no external deps) — KPI table for download. */
export function renderKpiReportPdf({ workspaceName, periodLabel, stats }) {
  const lines = [
    'Agent Market — KPI Report',
    `${workspaceName} | ${periodLabel}`,
    '',
    `Total Budget: $${Number(stats.total_budget || 0).toFixed(2)}`,
    `Total Spend: $${Number(stats.total_spend || 0).toFixed(2)}`,
    `Budget Remaining: $${Number(stats.budget_remaining || 0).toFixed(2)}`,
    `Impressions: ${stats.total_impressions || 0}`,
    `Clicks: ${stats.total_clicks || 0}`,
    `CTR: ${stats.ctr != null ? `${Number(stats.ctr).toFixed(2)}%` : '—'}`,
    `CPC: ${stats.cpc != null ? `$${Number(stats.cpc).toFixed(2)}` : '—'}`,
    `Conversions: ${stats.total_conversions || 0}`,
    `CPA: ${stats.cpa != null ? `$${Number(stats.cpa).toFixed(2)}` : '—'}`,
    `Portfolio ROAS: ${stats.portfolio_roas != null ? `${Number(stats.portfolio_roas).toFixed(2)}x` : '—'}`,
    `Active Campaigns: ${stats.active_campaigns || 0}`,
    `Posts Published: ${stats.posts_published || 0}`,
    `Leads (${stats.period_days || 7}d): ${stats.leads_in_period || 0}`,
    `Attribution model: ${stats.attribution_model || 'linear'}`,
  ]

  const platforms = stats.by_platform || {}
  for (const [platform, row] of Object.entries(platforms)) {
    const label = BUDGET_PLATFORM_META[platform]?.label || platform
    lines.push('')
    lines.push(`${label}: budget $${Number(row.budget || 0).toFixed(2)} | spend $${Number(row.spend || 0).toFixed(2)}`)
  }

  if (Array.isArray(stats.attribution_top_sources) && stats.attribution_top_sources.length) {
    lines.push('')
    lines.push('Top lead sources (multi-touch):')
    for (const r of stats.attribution_top_sources) {
      lines.push(`  - ${r.key}: ${Number(r.credit ?? r.count).toFixed(2)}`)
    }
  }

  return buildSimplePdf(lines.join('\n'))
}

function escapePdfText(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function buildSimplePdf(text) {
  const lines = String(text).split('\n')
  const lineHeight = 14
  let y = 750
  let stream = 'BT /F1 11 Tf '
  for (let i = 0; i < lines.length; i += 1) {
    if (i === 0) {
      stream += `50 ${y} Td (${escapePdfText(lines[i])}) Tj `
    } else {
      stream += `0 -${lineHeight} Td (${escapePdfText(lines[i])}) Tj `
    }
  }
  stream += 'ET'
  const objects = []
  objects.push('1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj')
  objects.push('2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj')
  objects.push(
    '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] '
    + '/Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj',
  )
  objects.push(`4 0 obj<< /Length ${Buffer.byteLength(stream, 'utf8')} >>stream\n${stream}\nendstream endobj`)
  objects.push('5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj')

  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'))
    pdf += `${obj}\n`
  }
  const xrefStart = Buffer.byteLength(pdf, 'utf8')
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`
  return Buffer.from(pdf, 'utf8')
}
