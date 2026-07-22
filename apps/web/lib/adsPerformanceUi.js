/**
 * Ads Performance Simple view — normalize Google + Meta live reports
 * into one shape for a reports-like UI.
 */

import { format, subDays, differenceInCalendarDays, parseISO } from 'date-fns'
import { api } from './api.js'
import { metaActId } from './metaInsightsUi.js'
import {
  normalizeGoogleReportRows,
  summaryFromAccountResponse,
} from './googleInsightsUi.js'

export const ADS_PERF_PRESETS = [
  { id: '7d', label: 'Last 7 days', google: 'LAST_7_DAYS', meta: 'last_7d', days: 7 },
  { id: '30d', label: 'Last 30 days', google: 'LAST_30_DAYS', meta: 'last_30d', days: 30 },
  { id: '90d', label: 'Last 90 days', google: 'LAST_90_DAYS', meta: 'last_90d', days: 90 },
]

export function presetById(id) {
  return ADS_PERF_PRESETS.find((p) => p.id === id) || ADS_PERF_PRESETS[1]
}

export function defaultDateRange() {
  return {
    preset: '30d',
    from: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
    to: format(new Date(), 'yyyy-MM-dd'),
  }
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function emptyTotals() {
  return {
    spend: null,
    budget: null,
    clicks: null,
    impressions: null,
    conversions: null,
    conversion_value: null,
    ctr: null,
    cpc: null,
    cpm: null,
    cpa: null,
    roas: null,
    reach: null,
    frequency: null,
    unique_clicks: null,
  }
}

/** Meta budgets are often cents; Google performance returns currency units. */
export function budgetFromRow(row) {
  if (!row || typeof row !== 'object') return null
  const hasMetaCents = row.daily_budget != null || row.lifetime_budget != null
  if (!hasMetaCents && row.budget != null && row.budget !== '' && Number.isFinite(Number(row.budget))) {
    return { amount: Number(row.budget), type: row.budget_type || 'daily' }
  }
  if (row.daily_budget != null && row.daily_budget !== '' && Number.isFinite(Number(row.daily_budget))) {
    return { amount: Number(row.daily_budget) / 100, type: 'daily' }
  }
  if (row.lifetime_budget != null && row.lifetime_budget !== '' && Number.isFinite(Number(row.lifetime_budget))) {
    return { amount: Number(row.lifetime_budget) / 100, type: 'lifetime' }
  }
  if (row.budget != null && row.budget !== '' && Number.isFinite(Number(row.budget))) {
    return { amount: Number(row.budget), type: row.budget_type || 'daily' }
  }
  return null
}

export function formatBudget(amount, type = 'daily') {
  if (amount == null || amount === '') return '—'
  if (typeof amount === 'number' && Number.isNaN(amount)) return '—'
  const money = `$${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (type === 'lifetime') return `${money} lifetime`
  return `${money}/day`
}

function deriveRates(t) {
  const out = { ...t }
  const impressions = out.impressions
  const clicks = out.clicks
  const spend = out.spend
  const conversions = out.conversions
  if (impressions != null && impressions > 0) {
    if (out.ctr == null || !(out.ctr > 0)) out.ctr = ((clicks || 0) / impressions) * 100
    if (out.cpm == null && spend != null) out.cpm = (spend / impressions) * 1000
  } else if (out.ctr == null && impressions === 0) {
    // Fetched zero impressions → CTR is 0, not missing
    out.ctr = 0
  }
  if (clicks != null && clicks > 0 && out.cpc == null && spend != null) {
    out.cpc = spend / clicks
  }
  if (conversions != null && conversions > 0 && out.cpa == null && spend != null) {
    out.cpa = spend / conversions
  }
  if (spend != null && spend > 0 && out.conversion_value != null && out.conversion_value > 0 && out.roas == null) {
    out.roas = out.conversion_value / spend
  }
  return out
}

function totalsFromParts({
  spend,
  clicks,
  impressions,
  conversions,
  conversion_value = null,
  cpc = null,
  cpm = null,
  cpa = null,
  roas = null,
  reach = null,
  frequency = null,
  unique_clicks = null,
  ctr = null,
}) {
  const t = {
    // Present numbers (including 0) stay; absent → null so UI shows "—"
    spend: spend == null || spend === '' ? null : num(spend),
    clicks: clicks == null || clicks === '' ? null : num(clicks),
    impressions: impressions == null || impressions === '' ? null : num(impressions),
    conversions: conversions == null || conversions === '' ? null : num(conversions),
    conversion_value: conversion_value == null || conversion_value === '' ? null : num(conversion_value),
    ctr: ctr == null || ctr === '' ? null : num(ctr),
    cpc: cpc == null || cpc === '' ? null : num(cpc),
    cpm: cpm == null || cpm === '' ? null : num(cpm),
    cpa: cpa == null || cpa === '' ? null : num(cpa),
    roas: roas == null || roas === '' ? null : num(roas),
    reach: reach == null || reach === '' ? null : num(reach),
    frequency: frequency == null || frequency === '' ? null : num(frequency),
    unique_clicks: unique_clicks == null || unique_clicks === '' ? null : num(unique_clicks),
  }
  return deriveRates(t)
}

function sumMetaActions(actions) {
  if (!Array.isArray(actions) || !actions.length) return null
  const preferred = actions.filter((a) => {
    const t = String(a.action_type || '').toLowerCase()
    return (
      t.includes('purchase')
      || t === 'lead'
      || t.includes('complete_registration')
      || t.includes('submit_application')
      || t.includes('contact')
      || t.includes('subscribe')
    )
  })
  const list = preferred.length ? preferred : actions
  return list.reduce((s, a) => s + num(a.value), 0)
}

function sumCampaignRows(rows) {
  if (!rows?.length) return emptyTotals()
  const acc = {
    spend: 0,
    budget: 0,
    clicks: 0,
    impressions: 0,
    conversions: 0,
    conversion_value: 0,
    reach: 0,
    unique_clicks: 0,
  }
  let hasConversionValue = false
  let hasReach = false
  let hasUnique = false
  let hasBudget = false
  for (const r of rows) {
    acc.spend += num(r.spend ?? r.cost)
    acc.clicks += num(r.clicks)
    acc.impressions += num(r.impressions)
    acc.conversions += num(r.conversions)
    if (r.budget != null && Number.isFinite(Number(r.budget))) {
      hasBudget = true
      acc.budget += num(r.budget)
    }
    if (r.conversion_value != null) {
      hasConversionValue = true
      acc.conversion_value += num(r.conversion_value)
    }
    if (r.reach != null) {
      hasReach = true
      acc.reach += num(r.reach)
    }
    if (r.unique_clicks != null) {
      hasUnique = true
      acc.unique_clicks += num(r.unique_clicks)
    }
  }
  const totals = totalsFromParts({
    ...acc,
    conversion_value: hasConversionValue ? acc.conversion_value : null,
    reach: hasReach ? acc.reach : null,
    unique_clicks: hasUnique ? acc.unique_clicks : null,
  })
  totals.budget = hasBudget ? acc.budget : null
  return totals
}

function googleSummaryToTotals(summary) {
  if (!summary) return emptyTotals()
  const spend = summary.total_cost ?? summary.cost ?? summary.spend
  const clicks = summary.total_clicks ?? summary.clicks
  const impressions = summary.total_impressions ?? summary.impressions
  const conversions = summary.total_conversions ?? summary.conversions
  const conversion_value =
    summary.total_conversion_value ?? summary.conversions_value ?? summary.conversion_value
  return totalsFromParts({
    spend,
    clicks,
    impressions,
    conversions,
    conversion_value,
    ctr: summary.average_ctr ?? summary.ctr,
    cpc: summary.average_cpc ?? summary.cpc,
    cpm: summary.average_cpm ?? summary.cpm,
    cpa: summary.cost_per_conversion ?? summary.cpa,
    roas: summary.roas,
  })
}

function metaRowToTotals(row) {
  if (!row) return emptyTotals()
  let conversions = row.conversions != null ? num(row.conversions) : null
  if (conversions == null && Array.isArray(row.actions)) {
    conversions = sumMetaActions(row.actions)
  }
  let conversion_value = null
  if (Array.isArray(row.action_values) && row.action_values.length) {
    conversion_value = sumMetaActions(row.action_values)
  }
  return totalsFromParts({
    spend: row.spend,
    clicks: row.clicks,
    impressions: row.impressions,
    conversions: conversions == null ? 0 : conversions,
    conversion_value,
    ctr: row.ctr != null ? num(row.ctr) : null,
    cpc: row.cpc != null ? num(row.cpc) : null,
    cpm: row.cpm != null ? num(row.cpm) : null,
    reach: row.reach != null ? num(row.reach) : null,
    frequency: row.frequency != null ? num(row.frequency) : null,
    unique_clicks: row.unique_clicks != null ? num(row.unique_clicks) : null,
  })
}

function displayCampaignName(raw, id) {
  const original = String(raw || '').trim()
  if (!original) return id ? `Campaign ${id}` : 'Untitled campaign'
  const inner = original.match(/«\s*([^»]*)\s*»/)
  if (inner) {
    const text = (inner[1] || '').trim()
    if (text) return text.length > 80 ? `${text.slice(0, 77)}…` : text
    return id ? `Campaign ${id}` : 'Untitled campaign'
  }
  if (/^publication\s*:\s*$/i.test(original)) {
    return id ? `Campaign ${id}` : 'Untitled campaign'
  }
  return original
}

function mapMetaStatus(status) {
  if (status == null || status === '') return null
  const s = String(status).toUpperCase()
  const map = {
    ACTIVE: 'active',
    PAUSED: 'paused',
    DELETED: 'ended',
    ARCHIVED: 'ended',
    CAMPAIGN_PAUSED: 'paused',
    IN_PROCESS: 'active',
    WITH_ISSUES: 'paused',
  }
  return map[s] || String(status).toLowerCase()
}

function normalizeCampaignRow(row, provider, opts = {}) {
  const listOnly = Boolean(opts.listOnly)
  const id =
    row.campaign_id ||
    row.google_campaign_id ||
    row.id ||
    row.platform_campaign_id ||
    ''
  const hasMetricFields =
    row.spend != null
    || row.cost != null
    || row.impressions != null
    || row.clicks != null
  // listOnly = campaign/ad set config without insights for the selected period
  const metricsMissing = listOnly && !hasMetricFields

  const spend = metricsMissing ? null : num(row.spend ?? row.cost)
  const clicks = metricsMissing ? null : num(row.clicks)
  const impressions = metricsMissing ? null : num(row.impressions)
  let conversions = metricsMissing ? null : num(row.conversions)
  if (!metricsMissing && !conversions && Array.isArray(row.actions)) {
    const fromActions = sumMetaActions(row.actions)
    conversions = fromActions == null ? 0 : fromActions
  }
  let conversion_value =
    row.conversion_value != null || row.conversions_value != null
      ? num(row.conversion_value ?? row.conversions_value)
      : null
  if (conversion_value == null && Array.isArray(row.action_values)) {
    conversion_value = sumMetaActions(row.action_values)
  }
  let ctr = metricsMissing ? null : (row.ctr != null ? num(row.ctr) : null)
  if (ctr != null && ctr > 0 && ctr <= 1 && provider === 'google_ads') ctr *= 100
  if (!metricsMissing && ctr == null && impressions > 0) ctr = (clicks / impressions) * 100
  if (!metricsMissing && ctr == null && impressions === 0) ctr = 0
  const cpc = metricsMissing
    ? null
    : row.average_cpc != null || row.cpc != null
      ? num(row.average_cpc ?? row.cpc)
      : clicks > 0
        ? spend / clicks
        : null
  const cpm = metricsMissing
    ? null
    : row.cpm != null
      ? num(row.cpm)
      : impressions > 0
        ? (spend / impressions) * 1000
        : null
  const cpa = metricsMissing
    ? null
    : row.cost_per_conversion != null
      ? num(row.cost_per_conversion)
      : conversions > 0
        ? spend / conversions
        : null
  const roas =
    !metricsMissing && spend > 0 && conversion_value != null && conversion_value > 0
      ? conversion_value / spend
      : null
  const status =
    mapMetaStatus(row.status || row.effective_status || row.configured_status) || null
  const budgetInfo = budgetFromRow(row)
  return {
    id: String(id),
    name: displayCampaignName(row.campaign_name || row.name || row.adset_name, id),
    status: status || '—',
    budget: budgetInfo != null ? budgetInfo.amount : null,
    budget_type: budgetInfo != null ? budgetInfo.type : null,
    spend,
    clicks,
    impressions,
    conversions,
    conversion_value,
    ctr,
    cpc,
    cpm,
    cpa,
    roas,
    reach: row.reach != null ? num(row.reach) : null,
    frequency: row.frequency != null ? num(row.frequency) : null,
    unique_clicks: row.unique_clicks != null ? num(row.unique_clicks) : null,
  }
}

/** Unified Simple KPI definitions — platform-only metrics show "—" when unavailable. */
export const SIMPLE_KPI_DEFS = [
  { key: 'budget', label: 'Daily budget', format: 'budget_day' },
  { key: 'spend', label: 'Spend', format: 'money' },
  { key: 'impressions', label: 'Impressions', format: 'num' },
  { key: 'clicks', label: 'Clicks', format: 'num' },
  { key: 'ctr', label: 'CTR', format: 'pct' },
  { key: 'cpc', label: 'CPC', format: 'money' },
  { key: 'cpm', label: 'CPM', format: 'money' },
  { key: 'conversions', label: 'Conversions', format: 'num' },
  { key: 'cpa', label: 'CPA', format: 'money' },
  { key: 'conversion_value', label: 'Conv. value', format: 'money' },
  { key: 'roas', label: 'ROAS', format: 'roas' },
  { key: 'reach', label: 'Reach', format: 'num', platforms: ['meta_ads'] },
  { key: 'frequency', label: 'Frequency', format: 'num', platforms: ['meta_ads'] },
  { key: 'unique_clicks', label: 'Unique clicks', format: 'num', platforms: ['meta_ads'] },
]

export function formatKpiValue(format, value) {
  // null/undefined/'' → "—"; numeric 0 → formatted zero
  if (value == null || value === '') return '—'
  if (typeof value === 'number' && Number.isNaN(value)) return '—'
  if (format === 'money') return formatMoney(value)
  if (format === 'budget_day') return formatBudget(value, 'daily')
  if (format === 'pct') return formatPct(value)
  if (format === 'roas') return `${Number(value).toFixed(2)}x`
  return formatNum(value)
}

export function buildSimpleStatCards(totals, previousTotals = null, provider = null) {
  if (!totals) return []
  return SIMPLE_KPI_DEFS.filter((def) => {
    if (!def.platforms) return true
    return provider && def.platforms.includes(provider)
  }).map((def) => {
    // Fetched 0 → show 0; missing/null/undefined → —
    const raw = Object.prototype.hasOwnProperty.call(totals, def.key) ? totals[def.key] : null
    const prevHas = previousTotals && Object.prototype.hasOwnProperty.call(previousTotals, def.key)
    const prevRaw = prevHas ? previousTotals[def.key] : null
    return {
      key: def.key,
      label: def.label,
      value: formatKpiValue(def.format, raw),
      raw,
      prevRaw,
      prevValue: prevRaw != null ? formatKpiValue(def.format, prevRaw) : null,
    }
  })
}

function previousWindow(from, to) {
  const start = parseISO(from)
  const end = parseISO(to)
  const days = Math.max(1, differenceInCalendarDays(end, start) + 1)
  const prevEnd = subDays(start, 1)
  const prevStart = subDays(prevEnd, days - 1)
  return {
    from: format(prevStart, 'yyyy-MM-dd'),
    to: format(prevEnd, 'yyyy-MM-dd'),
  }
}

function mapAccountNotReadyError(err, connection) {
  const msg = String(err?.message || err || '')
  if (connection?.provider === 'google_ads' && connection?.needs_reconnect) {
    return {
      code: 'needs_customer',
      message: 'Select a Google Ads customer under Accounts before viewing performance.',
    }
  }
  if (/customer_id|customer id|reconnect|not authorized/i.test(msg)) {
    return {
      code: 'needs_customer',
      message: msg || 'Reconnect or select a Google Ads customer under Accounts.',
    }
  }
  return { code: 'error', message: msg || 'Failed to load performance' }
}

/**
 * Fetch Simple-view performance for one ads connection.
 * @returns {{ scope, totals, previousTotals, series, rows, error }}
 */
export async function fetchAdsPerformance({
  connection,
  preset = '30d',
  from,
  to,
  campaignId = '',
}) {
  const empty = {
    scope: campaignId ? 'campaign' : 'account',
    totals: emptyTotals(),
    previousTotals: null,
    series: [],
    rows: [],
    error: null,
  }

  if (!connection?.account_id) {
    return { ...empty, error: { code: 'no_account', message: 'Select an ads account' } }
  }

  if (connection.provider === 'google_ads' && connection.needs_reconnect) {
    return {
      ...empty,
      error: {
        code: 'needs_customer',
        message: 'Select a Google Ads customer under Accounts before viewing performance.',
      },
    }
  }

  const p = presetById(preset)
  const accountId = connection.account_id

  try {
    if (connection.provider === 'google_ads') {
      const params = {
        account_id: accountId,
        date_range: p.google,
      }
      if (campaignId) params.campaign_id = campaignId

      const [perfRes, summaryRes, dailyRes] = await Promise.all([
        api.googleCampaignPerformance(params),
        campaignId
          ? Promise.resolve(null)
          : api.googleAccountSummary(params).catch(() => null),
        api.googleDaily(params).catch(() => null),
      ])

      const rawRows = normalizeGoogleReportRows('performance', perfRes)
      const rows = rawRows
        .map((r) => normalizeCampaignRow(r, 'google_ads'))
        .filter((r) => !campaignId || r.id === String(campaignId))
        .sort((a, b) => b.spend - a.spend)

      let totals = campaignId
        ? sumCampaignRows(rows)
        : googleSummaryToTotals(summaryFromAccountResponse(summaryRes)) || sumCampaignRows(rows)

      // Account summary has spend KPIs only — attach budget sum from campaign rows
      if (!campaignId && rows.length) {
        const hasBudget = rows.some((r) => r.budget != null)
        const budgetSum = rows.reduce((s, r) => s + (r.budget != null ? num(r.budget) : 0), 0)
        totals = { ...totals, budget: hasBudget ? budgetSum : null }
      }

      const dailyItems = normalizeGoogleReportRows('performance', dailyRes)
      const series = (Array.isArray(dailyItems) ? dailyItems : [])
        .map((d) => ({
          date: d.date,
          spend: num(d.spend),
          clicks: num(d.clicks),
        }))
        .filter((d) => d.date)

      return {
        scope: campaignId ? 'campaign' : 'account',
        totals,
        previousTotals: null,
        series,
        rows: campaignId ? rows : rows.slice(0, 50),
        error: null,
      }
    }

    if (connection.provider === 'meta_ads') {
      const actId = metaActId(connection.ad_account_id)
      if (!actId) {
        return {
          ...empty,
          error: {
            code: 'needs_customer',
            message: 'Connect a Meta ad account under Accounts before viewing performance.',
          },
        }
      }

      const useCustom = from && to
      const timeParams = useCustom
        ? { since: from, until: to }
        : { time_range: p.meta }

      const objectId = campaignId || actId
      const level = campaignId ? 'adset' : 'campaign'

      const [campaignRes, accountRes, dailyRes, listRes, adSetRes] = await Promise.all([
        api.metaInsights({
          account_id: accountId,
          object_id: objectId,
          level,
          limit: 100,
          ...timeParams,
        }),
        campaignId
          ? api.metaInsights({
              account_id: accountId,
              object_id: campaignId,
              level: 'campaign',
              limit: 1,
              ...timeParams,
            }).catch(() => null)
          : api.metaInsights({
              account_id: accountId,
              object_id: actId,
              level: 'account',
              limit: 1,
              ...timeParams,
            }).catch(() => null),
        api.metaInsights({
          account_id: accountId,
          object_id: objectId,
          level: campaignId ? 'campaign' : 'account',
          limit: 100,
          time_increment: 1,
          ...timeParams,
        }).catch(() => null),
        // Insights rows often omit status / have empty boosted-post names — merge list metadata
        api.metaCampaigns({
          account_id: accountId,
          ad_account_id: actId,
          limit: 200,
        }).catch(() => null),
        campaignId
          ? api.metaAdSets({
              account_id: accountId,
              campaign_id: campaignId,
              limit: 200,
            }).catch(() => null)
          : Promise.resolve(null),
      ])

      const extractRows = (res) => {
        const payload = res?.data || res?.payload || res?.items || res
        if (Array.isArray(payload)) return payload
        if (Array.isArray(payload?.data)) return payload.data
        return []
      }

      const metaList = extractRows(listRes)
      const metaById = new Map()
      for (const c of metaList) {
        const cid = String(c.id || c.campaign_id || '')
        if (cid) metaById.set(cid, c)
      }

      const adSetList = extractRows(adSetRes)
      const adSetById = new Map()
      for (const a of adSetList) {
        const aid = String(a.id || a.adset_id || '')
        if (aid) adSetById.set(aid, a)
      }

      const isWeakCampaignName = (n) => {
        const s = String(n || '').trim()
        if (!s) return true
        if (/^publication\s*:\s*$/i.test(s)) return true
        const inner = s.match(/«\s*([^»]*)\s*»/)
        if (inner && !(inner[1] || '').trim()) return true
        return false
      }

      const enrichMetaRow = (r, { adSet = false } = {}) => {
        const cid = String(r.campaign_id || r.adset_id || r.id || '')
        const meta = adSet ? adSetById.get(cid) : metaById.get(cid)
        if (!meta) return r
        const insightName = r.campaign_name || r.adset_name || r.name
        const bestName = isWeakCampaignName(insightName)
          ? meta.name || insightName
          : insightName || meta.name
        return {
          ...r,
          campaign_name: bestName,
          name: bestName,
          status: r.status || r.effective_status || meta.status || meta.effective_status || meta.configured_status,
          effective_status: r.effective_status || meta.effective_status || meta.status,
          daily_budget: r.daily_budget ?? meta.daily_budget,
          lifetime_budget: r.lifetime_budget ?? meta.lifetime_budget,
        }
      }

      const childRows = extractRows(campaignRes)
      const accountRows = extractRows(accountRes)
      const dailyRows = extractRows(dailyRes)

      let rows = childRows
        .map((r) => {
          if (campaignId) {
            return normalizeCampaignRow(
              enrichMetaRow(
                {
                  ...r,
                  campaign_id: r.adset_id || r.id,
                  campaign_name: r.adset_name || r.name,
                },
                { adSet: true },
              ),
              'meta_ads',
            )
          }
          return normalizeCampaignRow(enrichMetaRow(r), 'meta_ads')
        })
        .sort((a, b) => (b.spend || 0) - (a.spend || 0))

      // Insights empty for the period, but campaigns still have real configured budgets —
      // show those campaigns (metrics as "—") so Budget is not an orphan KPI.
      if (!campaignId && rows.length === 0 && metaList.length) {
        rows = metaList
          .map((c) =>
            normalizeCampaignRow(
              {
                campaign_id: c.id,
                campaign_name: c.name,
                name: c.name,
                status: c.status || c.effective_status || c.configured_status,
                daily_budget: c.daily_budget,
                lifetime_budget: c.lifetime_budget,
              },
              'meta_ads',
              { listOnly: true },
            ),
          )
          .sort((a, b) => (b.budget || 0) - (a.budget || 0))
      } else if (campaignId && rows.length === 0 && adSetList.length) {
        rows = adSetList
          .map((a) =>
            normalizeCampaignRow(
              {
                campaign_id: a.id || a.adset_id,
                campaign_name: a.name || a.adset_name,
                name: a.name || a.adset_name,
                status: a.status || a.effective_status,
                daily_budget: a.daily_budget,
                lifetime_budget: a.lifetime_budget,
              },
              'meta_ads',
              { listOnly: true },
            ),
          )
          .sort((a, b) => (b.budget || 0) - (a.budget || 0))
      }

      let totals = metaRowToTotals(accountRows[0])
      if (!accountRows[0]) totals = sumCampaignRows(rows)

      // Configured budget is real Meta data (not period spend). Prefer row budgets;
      // if insights returned no rows we built list-only rows above.
      {
        const hasBudget = rows.some((r) => r.budget != null)
        const budgetSum = rows.reduce((s, r) => s + (r.budget != null ? num(r.budget) : 0), 0)
        if (hasBudget) {
          totals = { ...totals, budget: budgetSum }
        } else if (!campaignId && metaList.length) {
          let fromList = 0
          let any = false
          for (const c of metaList) {
            const b = budgetFromRow(c)
            if (b != null) {
              any = true
              fromList += b.amount
            }
          }
          totals = { ...totals, budget: any ? fromList : null }
        } else {
          totals = { ...totals, budget: null }
        }
      }

      let previousTotals = null
      if (useCustom && from && to) {
        try {
          const prev = previousWindow(from, to)
          const prevObject = campaignId || actId
          const prevRes = await api.metaInsights({
            account_id: accountId,
            object_id: prevObject,
            level: campaignId ? 'campaign' : 'account',
            limit: 1,
            since: prev.from,
            until: prev.to,
          })
          const prevRows = extractRows(prevRes)
          previousTotals = metaRowToTotals(prevRows[0])
        } catch {
          previousTotals = null
        }
      }

      const series = dailyRows
        .map((d) => ({
          date: d.date_start || d.date || d.date_stop,
          spend: num(d.spend),
          clicks: num(d.clicks),
        }))
        .filter((d) => d.date)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))

      return {
        scope: campaignId ? 'campaign' : 'account',
        totals,
        previousTotals,
        series,
        rows: rows.slice(0, 50),
        error: null,
      }
    }

    return {
      ...empty,
      error: { code: 'unsupported', message: 'Select a Google Ads or Meta Ads account' },
    }
  } catch (err) {
    return {
      ...empty,
      error: mapAccountNotReadyError(err, connection),
    }
  }
}

export function deltaPct(current, previous) {
  if (previous == null || previous === 0) return null
  return ((current - previous) / previous) * 100
}

export function formatMoney(v) {
  if (v == null || v === '') return '—'
  if (typeof v === 'number' && Number.isNaN(v)) return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatPct(v) {
  if (v == null || v === '') return '—'
  if (typeof v === 'number' && Number.isNaN(v)) return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(2)}%`
}

export function formatNum(v) {
  if (v == null || v === '') return '—'
  if (typeof v === 'number' && Number.isNaN(v)) return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString()
}
