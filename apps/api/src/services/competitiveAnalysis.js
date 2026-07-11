/**
 * Competitive analysis — scrape public pages + Meta Ads Library + ads marketing LLM.
 */
import { getDb } from '../lib/mongo.js'
import * as Account from '../models/Account.js'
import { enqueueCeleryAndWaitForJson } from '../lib/p2ExecCeleryReply.js'
import { enrichAdsToolPayload } from '../lib/adsToolPayload.js'
import { publishEvent } from '../lib/events.js'

async function resolveMetaAccountId(workspaceId, explicitAccountId) {
  if (explicitAccountId) return String(explicitAccountId)
  const accounts = await Account.findAll(workspaceId, { kind: 'ads' })
  const meta = accounts.filter(
    (a) => ['meta', 'meta_ads', 'facebook'].includes(a.provider) && a.authorized !== false,
  )
  if (meta.length === 1) return String(meta[0]._id)
  return null
}

export async function runCompetitiveAnalysis(workspaceId, {
  competitor_name: competitorName,
  competitor_urls: competitorUrls = [],
  our_business_context: ourBusinessContext,
  search_terms: searchTerms,
  ad_reached_countries: adReachedCountries,
  account_id: accountId,
  ads_library_limit: adsLibraryLimit,
} = {}) {
  if (!competitorName?.trim()) {
    throw Object.assign(new Error('competitor_name is required'), { statusCode: 422 })
  }

  const payload = {
    workspace_id: workspaceId,
    competitor_name: String(competitorName).trim(),
    competitor_urls: competitorUrls,
    our_business_context: ourBusinessContext,
    search_terms: searchTerms,
    ads_library_limit: adsLibraryLimit,
  }

  if (adReachedCountries) {
    payload.ad_reached_countries = adReachedCountries
    const metaAccountId = await resolveMetaAccountId(workspaceId, accountId)
    if (metaAccountId) payload.account_id = metaAccountId
  }

  let enriched = payload
  if (payload.account_id) {
    try {
      enriched = await enrichAdsToolPayload(workspaceId, 'meta_search_ads_library', payload)
    } catch {
      enriched = payload
    }
  }

  const json = await enqueueCeleryAndWaitForJson(
    'tasks.ads.execute_ads_tool',
    ['analyze_competitive_landscape', enriched],
    { timeoutMs: 180000 },
  )
  if (!json.ok) {
    throw Object.assign(new Error(json.error || 'Competitive analysis failed'), {
      statusCode: Number(json.status) || 422,
    })
  }

  const data = json.data || {}
  const doc = {
    workspace_id: workspaceId,
    kind: 'competitive_analysis',
    competitor_name: data.competitor_name || competitorName,
    pages_scraped: data.pages_scraped || [],
    ads_library_count: data.ads_library_count || 0,
    ads_library_error: data.ads_library_error || null,
    analysis: data.analysis || {},
    source: data.source || 'unknown',
    created_at: new Date(),
  }
  const inserted = await getDb().collection('ads_metrics').insertOne(doc)

  await publishEvent('ads.competitive_analysis_complete', {
    workspace_id: workspaceId,
    competitor_name: doc.competitor_name,
    source: doc.source,
  })

  return {
    id: inserted.insertedId.toString(),
    ...data,
  }
}

export async function listRecentCompetitiveAnalyses(workspaceId, { limit = 10 } = {}) {
  const rows = await getDb().collection('ads_metrics').find({
    workspace_id: workspaceId,
    kind: 'competitive_analysis',
  }).sort({ created_at: -1 }).limit(Math.min(50, Math.max(1, limit))).toArray()

  return rows.map((r) => ({
    id: r._id.toString(),
    competitor_name: r.competitor_name,
    analysis: r.analysis,
    pages_scraped: (r.pages_scraped || []).map((p) => ({
      url: p.url,
      ok: p.ok,
      title: p.title,
      error: p.error,
    })),
    ads_library_count: r.ads_library_count,
    source: r.source,
    created_at: r.created_at,
  }))
}
