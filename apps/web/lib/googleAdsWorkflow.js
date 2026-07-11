/**
 * Google Ads workflow ↔ tool payload alignment.
 * Field names match services/ai-worker/tools/ads/google/* and registry/tools.json.
 */

import { GOOGLE_GEO_PRESETS, parseGoogleGeoIds, parseGoogleNegativeKeywords } from './googleGeoConstants.js'
import { campaignTypeMeta, googlePublishToolForType, isSearchCampaignType, normalizeCampaignType } from './googleCampaignTypes.js'
import { keywordTextsFromEntries, parseGoogleKeywordEntries } from './googleKeywordParse.js'
import { googleRsaDraft, validateGoogleRsaForPublish } from './googleRsaValidation.js'

const GEO_BY_ID = Object.fromEntries(GOOGLE_GEO_PRESETS.map((p) => [p.id, p]))

/** Migrate legacy form keys from older wizard versions. */
export function normalizeGoogleFormValues(values = {}) {
  const v = { ...values }

  if (v.bid_location_json && typeof v.bid_location_json === 'string') {
    try {
      const loc = JSON.parse(v.bid_location_json)
      if (loc && typeof loc === 'object') {
        v.bid_adjustments = { ...(v.bid_adjustments || {}), location: loc }
      }
    } catch {
      /* ignore */
    }
  }

  if (!Array.isArray(v.geo_target_constant_ids) || !v.geo_target_constant_ids.length) {
    const legacy = parseGoogleGeoIds(v)
    if (legacy.length) v.geo_target_constant_ids = legacy
  }

  if (!Array.isArray(v.excluded_geo_target_constant_ids) || !v.excluded_geo_target_constant_ids.length) {
    const ex = Array.isArray(v.google_geo_exclude) ? v.google_geo_exclude : []
    if (ex.length) v.excluded_geo_target_constant_ids = ex.map(Number).filter(Number.isFinite)
  }

  if (!v.final_url && v.link_url) v.final_url = v.link_url

  return v
}

export function formatGeoIdList(ids) {
  if (!ids?.length) return '—'
  return ids
    .map((id) => {
      const p = GEO_BY_ID[Number(id)]
      return p ? `${p.label} (${id})` : String(id)
    })
    .join(', ')
}

/** Build Mongo campaign + publish payload (google_create_campaign + post-publish tools). */
export function buildGoogleCampaignPayload(values = {}) {
  const v = normalizeGoogleFormValues(values)
  const keywordEntries = parseGoogleKeywordEntries(v.keywords, v.keyword_match_type || 'BROAD')
  const { headlines, descriptions, linkUrl } = googleRsaDraft({
    headlines: v.headlines,
    descriptions: v.descriptions,
    link_url: v.final_url || v.link_url,
  })

  const geoIds = Array.isArray(v.geo_target_constant_ids)
    ? v.geo_target_constant_ids.map(Number).filter(Number.isFinite)
    : parseGoogleGeoIds(v)

  const excludeIds = Array.isArray(v.excluded_geo_target_constant_ids)
    ? v.excluded_geo_target_constant_ids.map(Number).filter(Number.isFinite)
    : []

  const negativeKw = parseGoogleNegativeKeywords(v)

  const targeting = {
    ...(geoIds.length ? { geo_target_constant_ids: geoIds } : {}),
    ...(excludeIds.length ? { excluded_geo_target_constant_ids: excludeIds } : {}),
    ...(negativeKw.length ? { negative_keywords: negativeKw } : {}),
    ...(v.positive_geo_target_type
      ? { positive_geo_target_type: v.positive_geo_target_type }
      : {}),
    ...(v.negative_geo_target_type
      ? { negative_geo_target_type: v.negative_geo_target_type }
      : {}),
    ...(keywordEntries.length ? { keyword_entries: keywordEntries } : {}),
    adgroup_status: (v.adgroup_status || 'PAUSED').toUpperCase(),
    ...(v.cpc_bid_micros != null && v.cpc_bid_micros !== ''
      ? { cpc_bid_micros: Number(v.cpc_bid_micros) }
      : {}),
    ...(Array.isArray(v.sitelinks) && v.sitelinks.length ? { sitelinks: v.sitelinks } : {}),
    ...(Array.isArray(v.callouts) && v.callouts.length ? { callouts: v.callouts } : {}),
    ...(Array.isArray(v.ad_schedules) && v.ad_schedules.length ? { ad_schedules: v.ad_schedules } : {}),
    ...(v.bid_adjustments && typeof v.bid_adjustments === 'object' ? { bid_adjustments: v.bid_adjustments } : {}),
    ...(v.audience_name || v.audience_id
      ? {
          audience: {
            name: v.audience_name || null,
            url_contains: v.audience_url_contains || null,
            audience_id: v.audience_id || null,
            bid_modifier: v.audience_bid_modifier != null && v.audience_bid_modifier !== ''
              ? parseFloat(v.audience_bid_modifier)
              : null,
          },
        }
      : {}),
  }

  const ctype = normalizeCampaignType(v.type)

  const creatives = {
    link_url: linkUrl,
    final_url: linkUrl,
    path1: (v.path1 || '').trim() || null,
    path2: (v.path2 || '').trim() || null,
    headlines,
    descriptions,
    ad_status: (v.ad_status || 'PAUSED').toUpperCase(),
    ...(v.long_headline ? { long_headline: String(v.long_headline).trim() } : {}),
    ...(v.business_name ? { business_name: String(v.business_name).trim() } : {}),
    ...(v.youtube_video_id ? { youtube_video_id: String(v.youtube_video_id).trim() } : {}),
    ...(v.youtube_url ? { youtube_url: String(v.youtube_url).trim() } : {}),
    ...(v.app_id ? { app_id: String(v.app_id).trim() } : {}),
    ...(v.app_store ? { app_store: String(v.app_store).trim() } : {}),
    ...(Array.isArray(v.marketing_image_data) && v.marketing_image_data.length
      ? { marketing_image_data: v.marketing_image_data }
      : {}),
    ...(Array.isArray(v.square_image_data) && v.square_image_data.length
      ? { square_image_data: v.square_image_data }
      : {}),
    ...(Array.isArray(v.logo_image_data) && v.logo_image_data.length
      ? { logo_image_data: v.logo_image_data }
      : {}),
  }

  const payload = {
    name: v.name,
    platform: 'google_ads',
    type: ctype,
    account_id: v.account_id || null,
    budget: {
      amount: parseFloat(v.budget_amount) || 0,
      currency: v.budget_currency || 'USD',
      type: 'daily',
    },
    start_date: v.start_date || null,
    end_date: v.end_date || null,
    schedule_timezone: (v.schedule_timezone || '').trim() || null,
    keywords: keywordTextsFromEntries(keywordEntries),
    targeting: {
      ...targeting,
      ...(v.schedule_timezone ? { schedule_timezone: v.schedule_timezone.trim() } : {}),
      ...(v.merchant_id ? { merchant_id: String(v.merchant_id).trim() } : {}),
      ...(v.sales_country ? { sales_country: String(v.sales_country).trim().toUpperCase() } : {}),
      ...(v.feed_label ? { feed_label: String(v.feed_label).trim() } : {}),
    },
    creatives,
  }

  if (v.merchant_id) payload.merchant_id = String(v.merchant_id).trim()
  if (v.feed_label) payload.feed_label = String(v.feed_label).trim()
  else if (v.sales_country) payload.feed_label = String(v.sales_country).trim().toUpperCase()
  if (v.sales_country) payload.sales_country = String(v.sales_country).trim().toUpperCase()
  if (v.target_cpa != null && v.target_cpa !== '') {
    payload.target_cpa_micros = Math.round(parseFloat(v.target_cpa) * 1_000_000)
  }
  if (v.app_id) payload.app_id = String(v.app_id).trim()
  if (v.app_store) payload.app_store = String(v.app_store).trim()
  if (v.youtube_video_id) payload.youtube_video_id = String(v.youtube_video_id).trim()
  if (v.youtube_url) payload.youtube_url = String(v.youtube_url).trim()
  if (geoIds.length) payload.geo_target_constant_ids = geoIds

  return payload
}

/**
 * Review step rows grouped by tool (label matches registry tool_id).
 * @returns {{ tool: string, rows: { key: string, label: string, value: string }[] }[]}
 */
export function buildGoogleReviewSections(values = {}) {
  const v = normalizeGoogleFormValues(values)
  const payload = buildGoogleCampaignPayload(v)
  const keywordEntries = payload.targeting?.keyword_entries || []
  const rsa = googleRsaDraft({
    headlines: v.headlines,
    descriptions: v.descriptions,
    link_url: payload.creatives?.link_url,
  })

  const sections = []

  const neg = payload.targeting?.negative_keywords || []
  if (neg.length) {
    sections.push({
      tool: 'google_add_negative_keywords',
      rows: [{ key: 'keywords', label: 'keywords', value: neg.join(', ') }],
    })
  }

  const sl = payload.targeting?.sitelinks || []
  if (sl.length) {
    sections.push({
      tool: 'google_create_sitelink_extensions',
      rows: [{ key: 'sitelinks', label: 'sitelinks', value: sl.map((s) => `${s.text} → ${s.url}`).join('; ') }],
    })
  }

  const co = payload.targeting?.callouts || []
  if (co.length) {
    sections.push({
      tool: 'google_create_callout_extensions',
      rows: [{ key: 'callouts', label: 'callouts', value: co.join(', ') }],
    })
  }

  sections.unshift({
    tool: googlePublishToolForType(payload.type),
    rows: [
      { key: 'name', label: 'name', value: payload.name || '—' },
      { key: 'type', label: 'type (channel)', value: payload.type || 'search' },
      { key: 'account_id', label: 'account_id', value: v.account_id || '—' },
      {
        key: 'budget',
        label: 'budget.amount (daily)',
        value: `${payload.budget?.amount ?? 0} ${payload.budget?.currency || 'USD'}`,
      },
      {
        key: 'schedule_timezone',
        label: 'schedule_timezone',
        value: payload.schedule_timezone || '(Google Ads account timezone)',
      },
      {
        key: 'start_date',
        label: 'start_date',
        value: payload.start_date
          ? `${payload.start_date}${payload.type === 'search' ? ' (draft only for Search)' : ''}`
          : '—',
      },
      { key: 'end_date', label: 'end_date', value: payload.end_date || '—' },
      {
        key: 'adgroup_status',
        label: 'adgroup_status',
        value: payload.targeting?.adgroup_status || 'PAUSED',
      },
      {
        key: 'cpc_bid_micros',
        label: 'cpc_bid_micros',
        value:
          payload.targeting?.cpc_bid_micros != null
            ? `${payload.targeting.cpc_bid_micros} (uses Manual CPC on campaign + ad group)`
            : '— (Target Spend — automated bidding, no ad group CPC)',
      },
      {
        key: 'keyword_entries',
        label: 'keyword_entries',
        value: keywordEntries.length
          ? keywordEntries.map((e) => `${e.text} [${e.match_type}]`).join('; ')
          : '—',
      },
      { key: 'final_url', label: 'creatives.final_url', value: rsa.linkUrl || '—' },
      {
        key: 'headlines',
        label: 'creatives.headlines',
        value: rsa.headlines.length ? rsa.headlines.join(' | ') : '—',
      },
      {
        key: 'descriptions',
        label: 'creatives.descriptions',
        value: rsa.descriptions.length ? rsa.descriptions.join(' | ') : '—',
      },
      { key: 'path1', label: 'creatives.path1', value: payload.creatives?.path1 || '—' },
      { key: 'path2', label: 'creatives.path2', value: payload.creatives?.path2 || '—' },
      { key: 'ad_status', label: 'creatives.ad_status', value: payload.creatives?.ad_status || 'PAUSED' },
    ],
  })

  const geoIds = payload.targeting?.geo_target_constant_ids || []
  if (geoIds.length) {
    sections.push({
      tool: 'google_create_geo_targeting',
      rows: [
        {
          key: 'geo_target_constant_ids',
          label: 'geo_target_constant_ids',
          value: formatGeoIdList(geoIds),
        },
      ],
    })
  }

  const excludeIds = payload.targeting?.excluded_geo_target_constant_ids || []
  if (excludeIds.length) {
    sections.push({
      tool: 'google_exclude_geo_targets',
      rows: [
        {
          key: 'geo_target_constant_ids',
          label: 'geo_target_constant_ids (exclude)',
          value: formatGeoIdList(excludeIds),
        },
      ],
    })
  }

  const schedules = payload.targeting?.ad_schedules || []
  if (schedules.length) {
    sections.push({
      tool: 'google_create_ad_schedule',
      rows: [{ key: 'schedules', label: 'schedules', value: JSON.stringify(schedules) }],
    })
  }

  const bidAdj = payload.targeting?.bid_adjustments
  if (bidAdj && (Object.keys(bidAdj.device || {}).length || Object.keys(bidAdj.location || {}).length)) {
    sections.push({
      tool: 'google_set_bid_adjustments',
      rows: [{ key: 'adjustments', label: 'adjustments', value: JSON.stringify(bidAdj) }],
    })
  }

  const aud = payload.targeting?.audience
  if (aud && (aud.name || aud.audience_id)) {
    sections.push({
      tool: aud.audience_id ? 'google_add_audience_targeting' : 'google_create_custom_audience',
      rows: [
        ...(aud.name ? [{ key: 'name', label: 'audience name', value: aud.name }] : []),
        ...(aud.url_contains ? [{ key: 'rules', label: 'url_contains', value: aud.url_contains }] : []),
        ...(aud.audience_id ? [{ key: 'audience_id', label: 'audience_id', value: aud.audience_id }] : []),
      ],
    })
  }

  if (v.positive_geo_target_type || v.negative_geo_target_type) {
    sections.push({
      tool: 'google_update_campaign_geo_target',
      rows: [
        ...(v.positive_geo_target_type
          ? [
              {
                key: 'positive_geo_target_type',
                label: 'positive_geo_target_type',
                value: v.positive_geo_target_type,
              },
            ]
          : []),
        ...(v.negative_geo_target_type
          ? [
              {
                key: 'negative_geo_target_type',
                label: 'negative_geo_target_type',
                value: v.negative_geo_target_type,
              },
            ]
          : []),
      ],
    })
  }

  return sections
}

export function validateGooglePublishReady(values = {}) {
  const v = normalizeGoogleFormValues(values)
  const type = normalizeCampaignType(v.type)
  const errors = []

  if (type === 'search') {
    return validateGoogleRsaForPublish({
      headlines: v.headlines,
      descriptions: v.descriptions,
      link_url: v.final_url || v.link_url,
    })
  }

  const url = (v.final_url || v.link_url || '').trim()
  if (!url) errors.push('final_url is required')

  const headlines = googleRsaDraft({ headlines: v.headlines }).headlines
  const descriptions = googleRsaDraft({ descriptions: v.descriptions }).descriptions

  if (type === 'video') {
    if (!(v.youtube_video_id || v.youtube_url || '').trim()) {
      errors.push('youtube_video_id or youtube_url is required for Video')
    }
    if (!v.logo_image_data && !v.logo_image_assets?.length) {
      errors.push('logo image is required for Video (VideoResponsiveAd)')
    }
  }
  if (['performance_max', 'local'].includes(type)) {
    if (headlines.length < 3) errors.push('Performance Max requires at least 3 headlines')
    if (descriptions.length < 2) errors.push('Performance Max requires at least 2 descriptions')
    if (!v.logo_image_data && !v.logo_image_assets?.length) {
      errors.push('logo image is required for Performance Max')
    }
    const hasMarketing = Array.isArray(v.marketing_image_data) && v.marketing_image_data.length
    const hasSquare = Array.isArray(v.square_image_data) && v.square_image_data.length
    if (!hasMarketing || !hasSquare) {
      errors.push('marketing_image_data and square_image_data are required for Performance Max')
    }
  }
  if (type === 'app' && !(v.app_id || '').trim()) {
    errors.push('app_id is required for App campaigns')
  }
  if (type === 'shopping' && !(v.merchant_id || '').trim()) {
    errors.push('merchant_id is required for Shopping')
  }
  if (['display', 'app'].includes(type) && headlines.length < 1) {
    errors.push('at least one headline is required')
  }
  if (type === 'display' && descriptions.length < 1) {
    errors.push('at least one description is required')
  }

  return { ok: errors.length === 0, errors }
}

export function validateGoogleWorkflowStep(stepId, values = {}) {
  const v = normalizeGoogleFormValues(values)
  const errors = []

  if (stepId === 'goal') {
    const meta = campaignTypeMeta(v.type)
    if (!meta) errors.push('Select a valid campaign channel type.')
  }

  if (stepId === 'campaign') {
    if (!(v.name || '').trim()) errors.push('name is required')
    if (!v.account_id) errors.push('account_id is required')
    const budget = parseFloat(v.budget_amount)
    if (!Number.isFinite(budget) || budget < 1) errors.push('budget.amount must be at least 1')
  }

  if (stepId === 'targeting') {
    const extra = String(v.geo_target_constant_ids_extra || '').trim()
    if (extra) {
      const invalid = extra.split(/[\s,]+/).filter((p) => p.trim() && !/^\d+$/.test(p.trim()))
      if (invalid.length) {
        errors.push('geo_target_constant_ids must be numeric IDs only (e.g. 2840, 2124)')
      }
    }
  }

  if (stepId === 'adgroup') {
    if (isSearchCampaignType(v.type)) {
      const entries = parseGoogleKeywordEntries(v.keywords, v.keyword_match_type || 'BROAD')
      if (!entries.length) {
        errors.push('keyword_entries: at least one keyword is required for Search')
      }
    }
  }

  if (stepId === 'ads') {
    if (isSearchCampaignType(v.type)) {
      const { ok, errors: rsaErrors } = validateGoogleRsaForPublish({
        headlines: v.headlines,
        descriptions: v.descriptions,
        link_url: v.final_url || v.link_url,
      })
      if (!ok) errors.push(...rsaErrors)
    } else {
      const { ok, errors: pubErrors } = validateGooglePublishReady(v)
      if (!ok) errors.push(...pubErrors)
    }
  }

  return { ok: errors.length === 0, errors }
}
