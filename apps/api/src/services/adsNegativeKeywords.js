/**
 * Google Ads negative keyword suggestions — shared by UI, Beat, and agent tools.
 */
import { getDb } from '../lib/mongo.js'
import * as Campaign from '../models/Campaign.js'
import * as Account from '../models/Account.js'
import { enqueueCeleryAndWaitForJson } from '../lib/p2ExecCeleryReply.js'
import { enrichAdsToolPayload } from '../lib/adsToolPayload.js'
import { publishEvent } from '../lib/events.js'

export async function suggestNegativeKeywords({
  workspace_id: workspaceId,
  account_id: accountId,
  platform_campaign_id: platformCampaignId,
  min_cost: minCost = 5,
  date_range: dateRange = 'LAST_30_DAYS',
}) {
  if (!workspaceId || !accountId || !platformCampaignId) {
    throw Object.assign(new Error('workspace_id, account_id, and platform_campaign_id are required'), { statusCode: 422 })
  }

  const enriched = await enrichAdsToolPayload(workspaceId, 'google_suggest_negative_keywords', {
    account_id: String(accountId),
    platform_campaign_id: String(platformCampaignId),
    date_range: dateRange,
    min_cost: minCost,
  })

  const json = await enqueueCeleryAndWaitForJson(
    'tasks.ads.execute_ads_tool',
    ['google_suggest_negative_keywords', enriched],
    { timeoutMs: 120000 },
  )
  if (!json.ok) {
    throw Object.assign(new Error(json.error || 'Negative keyword suggestion failed'), { statusCode: 422 })
  }
  return json.data || {}
}

export async function persistNegativeKeywordSuggestions({
  workspace_id: workspaceId,
  campaign_id: campaignId,
  account_id: accountId,
  platform_campaign_id: platformCampaignId,
  suggestions,
  source = 'google_suggest_negative_keywords',
}) {
  const doc = {
    workspace_id: workspaceId,
    campaign_id: campaignId || null,
    account_id: accountId,
    platform_campaign_id: platformCampaignId,
    kind: 'negative_keyword_suggestions',
    suggestions: suggestions || [],
    source,
    created_at: new Date(),
  }
  await getDb().collection('ads_keyword_research').insertOne(doc)
  return doc
}

export async function suggestAndPersistForCampaign(workspaceId, campaign, options = {}) {
  const accountId = campaign.account_id || campaign.ad_account_id || options.account_id
  const platformCampaignId = campaign.platform_campaign_id || campaign.platform?.campaign_id
  if (!accountId || !platformCampaignId) {
    return { skipped: true, reason: 'missing_account_or_platform_campaign_id' }
  }

  const acc = await Account.findById(accountId) || await Account.findByUuid(accountId)
  if (!acc || acc.provider !== 'google_ads') {
    return { skipped: true, reason: 'not_google_ads_account' }
  }

  const data = await suggestNegativeKeywords({
    workspace_id: workspaceId,
    account_id: accountId,
    platform_campaign_id: platformCampaignId,
    min_cost: options.min_cost,
    date_range: options.date_range,
  })

  const suggestions = data.suggestions || data.negatives || data.keywords || []
  await persistNegativeKeywordSuggestions({
    workspace_id: workspaceId,
    campaign_id: campaign._id?.toString(),
    account_id: accountId,
    platform_campaign_id: platformCampaignId,
    suggestions,
    source: data.source || 'google_suggest_negative_keywords',
  })

  await publishEvent('ads.negative_keywords_suggested', {
    workspace_id: workspaceId,
    campaign_id: campaign._id?.toString(),
    platform_campaign_id: platformCampaignId,
    count: suggestions.length,
  })

  return { ok: true, count: suggestions.length, suggestions }
}

/** Daily Beat: review eligible Google Search campaigns per workspace. */
export async function runDailyNegativeKeywordReview() {
  const db = getDb()
  const campaigns = await db.collection('ads_campaigns').find({
    deleted_at: null,
    status: 'active',
    platform: 'google_ads',
    platform_campaign_id: { $exists: true, $ne: null, $ne: '' },
  }).limit(200).toArray()

  const results = []
  for (const c of campaigns) {
    const wid = c.workspace_id
    if (!wid) continue
    try {
      const out = await suggestAndPersistForCampaign(String(wid), c)
      results.push({ campaign_id: c._id.toString(), ...out })
    } catch (err) {
      results.push({ campaign_id: c._id.toString(), error: err.message })
    }
  }
  return { campaigns: results.length, results }
}
