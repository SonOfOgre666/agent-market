/**
 * Meta Ads registry tools — UI helpers via POST /ads/tools/execute (same path as the AI agent).
 * Prefer GET wrappers in api.js when they exist (insights, list routes).
 */

import { api } from './api.js'

function unwrapExecute(res, label = 'Meta tool') {
  if (!res?.ok) {
    throw new Error(res?.error || `${label} failed`)
  }
  const inner = res.data
  if (inner && inner.ok === false) {
    throw new Error(inner.error || `${label} failed`)
  }
  return inner ?? res
}

/** Run any registered meta_* tool (account_id = connected Mongo account). */
export async function runMetaTool(toolId, payload = {}) {
  return unwrapExecute(await api.executeAdsTool(toolId, payload), toolId)
}

/** Graph `act_*` id for Marketing API. */
export function ensureActId(raw) {
  if (!raw) return ''
  const s = String(raw).trim()
  if (!s) return ''
  if (s.startsWith('act_')) return s
  return `act_${s.replace(/^act_/, '')}`
}

/**
 * Picker rows for ad accounts — same registry tool as the agent: ``meta_get_ad_accounts``.
 * Merges the Mongo-stored ad account so the dropdown always includes the connected act.
 *
 * @returns {{ accounts: Array, fetchError: string|null }} fetchError is set when Graph failed but rows may still exist from the stored connection.
 */
export async function listMetaAdAccounts(accountId, connectionRow, extra = {}) {
  const mergeUnique = (primary, extraRows) => {
    const out = [...(primary || [])]
    for (const row of extraRows || []) {
      if (row?.id && !out.some((x) => x.id === row.id)) out.push(row)
    }
    return out
  }
  const storedPicker = () => {
    if (!connectionRow?.ad_account_id) return []
    const id = ensureActId(connectionRow.ad_account_id)
    return [
      {
        id,
        name: connectionRow.ad_account_name || connectionRow.account_name || id,
        currency: connectionRow.currency || null,
        status_label: 'Connected',
      },
    ]
  }
  let fetchError = null
  let graphRows = []
  try {
    const out = await runMetaTool('meta_get_ad_accounts', {
      account_id: accountId,
      user_id: extra.user_id || 'me',
      limit: extra.limit ?? 200,
    })
    graphRows = out.accounts || []
  } catch (e) {
    fetchError = e.message || 'meta_get_ad_accounts failed'
    graphRows = []
  }
  const accounts = mergeUnique(graphRows, storedPicker())
  return { accounts, fetchError }
}

/**
 * Full ad account row (timezone, DSA flags, normalized spend) — ``meta_get_account`` (reference get_account_info).
 *
 * @returns {{ profile: object | null, error: string | null }}
 */
export async function fetchMetaAdAccountProfile(accountId, adAccountId, extra = {}) {
  const act = ensureActId(adAccountId)
  if (!accountId || !act) return { profile: null, error: null }
  try {
    const out = await runMetaTool('meta_get_account', {
      account_id: accountId,
      ad_account_id: act,
      fields: extra.fields || '',
    })
    const profile = out.account || null
    if (!profile) {
      return { profile: null, error: 'meta_get_account returned no account payload' }
    }
    return { profile, error: null }
  } catch (e) {
    let msg = e.message || 'meta_get_account failed'
    const details = e.body?.details
    if (details?.accessible_accounts?.length) {
      msg = `${msg} You may need a different act_* — ${details.total_accessible_accounts ?? details.accessible_accounts.length} accessible account(s) on this token.`
    }
    return { profile: null, error: msg }
  }
}

/**
 * High-demand budget schedule on a published Meta campaign — ``meta_create_budget_schedule``.
 * Requires Graph ``campaign_id`` (``platform_campaign_id``), Unix ``time_start`` / ``time_end``.
 */
export async function createMetaBudgetSchedule(accountId, params) {
  const {
    campaign_id: campaignId,
    budget_value: budgetValue,
    budget_value_type: budgetValueType,
    time_start: timeStart,
    time_end: timeEnd,
    api_version: apiVersion,
  } = params || {}
  if (!accountId) throw new Error('account_id is required')
  if (!campaignId) throw new Error('campaign_id (Meta platform campaign id) is required')
  return runMetaTool('meta_create_budget_schedule', {
    account_id: accountId,
    campaign_id: String(campaignId),
    budget_value: budgetValue,
    budget_value_type: budgetValueType,
    time_start: timeStart,
    time_end: timeEnd,
    ...(apiVersion ? { api_version: apiVersion } : {}),
  })
}

export async function searchGeoLocations(accountId, query, extra = {}) {
  const out = await runMetaTool('meta_search_geo_locations', {
    account_id: accountId,
    query,
    limit: extra.limit ?? 25,
    ...extra,
  })
  return out.data || out.results || []
}

export async function searchInterests(accountId, query, extra = {}) {
  const out = await runMetaTool('meta_search_interests', {
    account_id: accountId,
    query,
    limit: extra.limit ?? 25,
    ...extra,
  })
  return out.data || out.results || []
}

/**
 * Meta Ads Library archive (GET /ads_archive). Same execute path as geo/interests.
 * `ad_reached_countries`: ISO2 list or comma string (e.g. ['US'] or 'US,GB').
 */
export async function searchAdsArchive(accountId, searchTerms, adReachedCountries, extra = {}) {
  const countries = adReachedCountries
  if (!countries || (Array.isArray(countries) && countries.length === 0)) {
    throw new Error('ad_reached_countries is required (e.g. US or US,GB)')
  }
  const { ad_type: adType = 'ALL', limit = 25, fields = '', api_version: apiVersion } = extra
  const out = await runMetaTool('meta_search_ads_library', {
    account_id: accountId,
    search_terms: String(searchTerms || '').trim(),
    ad_reached_countries: countries,
    ad_type: adType,
    limit,
    fields,
    ...(apiVersion ? { api_version: apiVersion } : {}),
  })
  return { data: out.data || [], paging: out.paging }
}

export async function uploadAdImage(accountId, adAccountId, { image_url, file, name }) {
  const out = await runMetaTool('meta_upload_ad_image', {
    account_id: accountId,
    ad_account_id: adAccountId,
    image_url,
    file,
    name,
  })
  return out
}

export async function uploadAdVideo(accountId, adAccountId, { video_url, file, name }) {
  return runMetaTool('meta_upload_ad_video', {
    account_id: accountId,
    ad_account_id: adAccountId,
    video_url,
    file,
    name,
  })
}

export async function estimateAudienceSize(accountId, { adAccountId, targeting, optimizationGoal }) {
  return runMetaTool('meta_estimate_audience_size', {
    account_id: accountId,
    ad_account_id: adAccountId,
    targeting,
    optimization_goal: optimizationGoal || 'REACH',
  })
}

export function parseCountries(raw) {
  return String(raw || 'US')
    .split(/[,;\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z]{2}$/.test(s))
}

export function buildGeoTargeting(countriesRaw, flexibleSpec = null) {
  const countries = parseCountries(countriesRaw)
  const spec = {
    geo_locations: { countries: countries.length ? countries : ['US'] },
    age_min: 18,
    age_max: 65,
    targeting_automation: { advantage_audience: 0 },
  }
  if (flexibleSpec?.length) {
    spec.flexible_spec = flexibleSpec
  }
  return spec
}
