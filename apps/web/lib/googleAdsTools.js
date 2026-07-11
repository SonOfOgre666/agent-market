/**
 * Google Ads registry tools — UI helpers via POST /ads/tools/execute (same path as the AI agent).
 * Prefer GET wrappers in api.js when they exist (performance, sync routes).
 */

import { api } from './api.js'
import { googlePublishToolForType } from './googleCampaignTypes.js'

export { buildGoogleTargeting, parseGoogleGeoIds, parseGoogleNegativeKeywords, GOOGLE_GEO_PRESETS } from './googleGeoConstants.js'
export {
  buildGoogleCampaignPayload,
  buildGoogleReviewSections,
  normalizeGoogleFormValues,
  validateGoogleWorkflowStep,
} from './googleAdsWorkflow.js'

function unwrapExecute(res, label = 'Google tool') {
  if (!res?.ok) {
    throw new Error(res?.error || `${label} failed`)
  }
  const inner = res.data
  if (inner && inner.ok === false) {
    throw new Error(inner.error || `${label} failed`)
  }
  return inner ?? res
}

/** Run any registered google_* tool (account_id = connected Mongo account). */
export async function runGoogleTool(toolId, payload = {}) {
  return unwrapExecute(await api.executeAdsTool(toolId, payload), toolId)
}

/** List accessible Google Ads customer accounts (``google_get_ad_accounts``). */
export async function listGoogleAdAccounts(accountId, extra = {}) {
  const out = await runGoogleTool('google_get_ad_accounts', {
    account_id: accountId,
    ...extra,
  })
  return out.accounts || out.data || []
}

/** List campaigns for the connected customer (``google_list_campaigns``). */
export async function listGoogleCampaigns(accountId, extra = {}) {
  const out = await runGoogleTool('google_list_campaigns', {
    account_id: accountId,
    limit: extra.limit ?? 50,
    ...extra,
  })
  return out.data || []
}

/**
 * Customer profile (timezone, currency) — ``google_get_account`` (meta_get_account parity).
 */
export async function fetchGoogleAdAccountProfile(accountId) {
  try {
    const out = await runGoogleTool('google_get_account', { account_id: accountId })
    return { profile: out, error: null }
  } catch (e) {
    return { profile: null, error: e.message || 'google_get_account failed' }
  }
}

/** One campaign by id — ``google_get_campaign``. */
export async function getGoogleCampaign(accountId, platformCampaignId) {
  return runGoogleTool('google_get_campaign', {
    account_id: accountId,
    platform_campaign_id: platformCampaignId,
  })
}

/** List ad groups; optional campaign filter — ``google_list_ad_groups``. */
export async function listGoogleAdGroups(accountId, { campaignId, status, limit } = {}) {
  const out = await runGoogleTool('google_list_ad_groups', {
    account_id: accountId,
    platform_campaign_id: campaignId,
    status,
    limit: limit ?? 100,
  })
  return out.data || []
}

/**
 * Full Google publish chain — ``google_publish_campaign`` or typed variant (routes by type).
 */
export async function publishGoogleCampaign(accountId, payload, { toolId } = {}) {
  const type = payload?.type || 'search'
  return runGoogleTool(toolId || googlePublishToolForType(type), {
    account_id: accountId,
    type,
    ...payload,
  })
}

/** @deprecated use publishGoogleCampaign */
export async function publishGoogleSearchCampaign(accountId, payload) {
  return publishGoogleCampaign(accountId, { type: 'search', ...payload })
}

/** Create campaign budget (``google_create_budget``). amount in currency units unless amount_micros set. */
export async function createGoogleBudget(accountId, { name, dailyBudget, amountMicros, deliveryMethod } = {}) {
  const payload = { account_id: accountId, name }
  if (amountMicros != null) payload.amount_micros = amountMicros
  else if (dailyBudget != null) payload.daily_budget = dailyBudget
  if (deliveryMethod) payload.delivery_method = deliveryMethod
  return runGoogleTool('google_create_budget', payload)
}

/** Add location targeting (``google_create_geo_targeting``). US = 2840, Canada = 2124. */
export async function addGoogleGeoTargeting(accountId, { platformCampaignId, geoIds } = {}) {
  return runGoogleTool('google_create_geo_targeting', {
    account_id: accountId,
    platform_campaign_id: platformCampaignId,
    geo_target_constant_ids: geoIds,
  })
}

/** Update campaign status (``google_update_campaign``). status: active, paused, ended. */
export async function updateGoogleCampaignStatus(accountId, { platformCampaignId, status } = {}) {
  return runGoogleTool('google_update_campaign', {
    account_id: accountId,
    platform_campaign_id: platformCampaignId,
    status,
  })
}

/**
 * GAQL field docs (``google_docs_reporting_fields``).
 * @param {string} accountId - connected Mongo account (for same execute path as other tools)
 * @param {string[]} fields - e.g. ['campaign.name', 'metrics.clicks']
 */
export async function lookupGoogleReportingFields(accountId, fields) {
  return runGoogleTool('google_docs_reporting_fields', {
    account_id: accountId,
    fields,
  })
}

/**
 * Add keywords with per-entry match types (``google_add_keywords``).
 * @param {string} accountId
 * @param {{ adGroupId?: string, adGroupResourceName?: string, entries: { text: string, match_type?: string }[] }} opts
 */
export async function addGoogleKeywords(accountId, { adGroupId, adGroupResourceName, entries } = {}) {
  return runGoogleTool('google_add_keywords', {
    account_id: accountId,
    platform_ad_set_id: adGroupId,
    ad_group_resource_name: adGroupResourceName,
    keyword_entries: entries,
  })
}

export async function listGoogleAudiences(accountId, { limit } = {}) {
  const out = await runGoogleTool('google_list_audiences', { account_id: accountId, limit: limit ?? 100 })
  return out.data || []
}

export async function createGoogleCustomAudience(accountId, { name, audienceType, rules, description } = {}) {
  return runGoogleTool('google_create_custom_audience', {
    account_id: accountId,
    name,
    audience_type: audienceType || 'WEBSITE_VISITORS',
    rules: rules || {},
    description,
  })
}

export async function addGoogleAudienceTargeting(accountId, { adGroupId, audienceId, bidModifier } = {}) {
  return runGoogleTool('google_add_audience_targeting', {
    account_id: accountId,
    platform_ad_set_id: adGroupId,
    audience_id: audienceId,
    bid_modifier: bidModifier,
  })
}

export async function setGoogleBidAdjustments(accountId, { platformCampaignId, adjustments } = {}) {
  return runGoogleTool('google_set_bid_adjustments', {
    account_id: accountId,
    platform_campaign_id: platformCampaignId,
    adjustments,
  })
}

export async function createGoogleAdSchedule(accountId, { platformCampaignId, schedules } = {}) {
  return runGoogleTool('google_create_ad_schedule', {
    account_id: accountId,
    platform_campaign_id: platformCampaignId,
    schedules,
  })
}

export async function optimizeGoogleGeoTargeting(accountId, { platformCampaignId, dateRange } = {}) {
  return runGoogleTool('google_optimize_geographic_targeting', {
    account_id: accountId,
    platform_campaign_id: platformCampaignId,
    date_range: dateRange || 'LAST_30_DAYS',
  })
}

export async function suggestGoogleNegativeKeywords(accountId, { platformCampaignId, minCost } = {}) {
  return runGoogleTool('google_suggest_negative_keywords', {
    account_id: accountId,
    platform_campaign_id: platformCampaignId,
    date_range: 'LAST_30_DAYS',
    min_cost: minCost ?? 5,
  })
}

export async function fetchGoogleAccountHealth(accountId, { dateRange } = {}) {
  const dr = dateRange || 'LAST_30_DAYS'
  const [summary, hints, recs] = await Promise.all([
    runGoogleTool('google_report_account_summary', { account_id: accountId, date_range: dr }),
    runGoogleTool('google_report_optimization_hints', { account_id: accountId, date_range: dr }).catch(() => null),
    runGoogleTool('google_get_recommendations', { account_id: accountId, limit: 20 }).catch(() => null),
  ])
  return { summary, hints, recommendations: recs }
}
