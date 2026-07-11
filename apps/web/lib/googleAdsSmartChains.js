/**
 * Recommended Google Ads tool sequences — used by wizard Tool console and agent fallback hints.
 * Each step's output should supply IDs for the next (platform_campaign_id, platform_ad_set_id, audience_id).
 */

export const GOOGLE_SMART_CHAINS = [
  {
    id: 'search_launch',
    label: 'Launch Search RSA',
    description: 'Verify account → full Search publish (budget → RSA + keywords).',
    toolIds: ['google_get_account', 'google_publish_search_campaign'],
  },
  {
    id: 'display_launch',
    label: 'Launch Display',
    description: 'Full Display publish: budget → campaign → ad group → responsive display ad.',
    toolIds: ['google_get_account', 'google_publish_display_campaign'],
  },
  {
    id: 'video_launch',
    label: 'Launch Video',
    description: 'Full Video publish with YouTube asset + in-stream ad.',
    toolIds: ['google_get_account', 'google_publish_video_campaign'],
  },
  {
    id: 'shopping_launch',
    label: 'Launch Shopping',
    description: 'List Merchant Centers → full Shopping publish with listing group.',
    toolIds: ['google_get_account', 'google_list_merchant_centers', 'google_publish_shopping_campaign'],
  },
  {
    id: 'pmax_launch',
    label: 'Launch Performance Max',
    description: 'Full PMax publish: campaign → asset group → linked assets.',
    toolIds: ['google_get_account', 'google_publish_performance_max_campaign'],
  },
  {
    id: 'app_launch',
    label: 'Launch App',
    description: 'Full App (MULTI_CHANNEL) publish with app ad.',
    toolIds: ['google_get_account', 'google_publish_app_campaign'],
  },
  {
    id: 'local_launch',
    label: 'Launch Local',
    description: 'Full Local publish with local ad.',
    toolIds: ['google_get_account', 'google_publish_local_campaign'],
  },
  {
    id: 'typed_full_publish',
    label: 'Publish any channel type',
    description: 'google_publish_campaign routes by type in payload — full end-to-end chain.',
    toolIds: ['google_get_account', 'google_publish_campaign', 'google_add_language_targeting'],
  },
  {
    id: 'granular_build',
    label: 'Build step-by-step',
    description: 'Budget → campaign → ad group → keywords → RSA → geo → sitelinks → negatives → callouts.',
    toolIds: [
      'google_create_budget',
      'google_create_typed_campaign',
      'google_create_adgroup',
      'google_add_keywords',
      'google_create_ad',
      'google_create_geo_targeting',
      'google_create_sitelink_extensions',
      'google_add_negative_keywords',
      'google_create_callout_extensions',
    ],
  },
  {
    id: 'optimize_geo_bids',
    label: 'Optimize geography',
    description: 'Analyze location performance → apply bid modifiers (approval on write).',
    toolIds: ['google_get_location_performance', 'google_optimize_geographic_targeting', 'google_set_bid_adjustments'],
  },
  {
    id: 'optimize_negatives',
    label: 'Wasted search terms',
    description: 'Suggest high-cost terms → add campaign negatives.',
    toolIds: ['google_suggest_negative_keywords', 'google_add_negative_keywords'],
  },
  {
    id: 'audience_remarketing',
    label: 'Remarketing audience',
    description: 'Create website visitor list → attach to ad group.',
    toolIds: ['google_create_custom_audience', 'google_add_audience_targeting'],
  },
  {
    id: 'audience_existing',
    label: 'Use existing audience',
    description: 'List user lists → attach to ad group with optional bid modifier.',
    toolIds: ['google_list_audiences', 'google_add_audience_targeting'],
  },
  {
    id: 'dayparting',
    label: 'Ad schedule (dayparting)',
    description: 'Set hour-of-week bid schedules on a live campaign.',
    toolIds: ['google_create_ad_schedule'],
  },
  {
    id: 'device_bids',
    label: 'Device bid adjustments',
    description: 'Compare device performance → set mobile/desktop/tablet modifiers.',
    toolIds: ['google_get_device_performance', 'google_set_bid_adjustments'],
  },
  {
    id: 'account_health',
    label: 'Account health check',
    description: 'Performance + optimization hints + Google recommendations (read-only).',
    toolIds: [
      'google_report_account_summary',
      'google_report_optimization_hints',
      'google_get_recommendations',
    ],
  },
]

/** Pick a chain from user message keywords (UI quick-start). */
export function matchGoogleSmartChain(message = '') {
  const m = String(message).toLowerCase()
  if (/audience|remarketing|retarget|user list/.test(m)) {
    return /existing|list/.test(m) ? 'audience_existing' : 'audience_remarketing'
  }
  if (/schedule|daypart|hours|time of day/.test(m)) return 'dayparting'
  if (/negative|search term|wasted/.test(m)) return 'optimize_negatives'
  if (/geo|location|geographic|region/.test(m) && /optim|bid|adjust/.test(m)) return 'optimize_geo_bids'
  if (/device|mobile|desktop|tablet/.test(m) && /bid|adjust/.test(m)) return 'device_bids'
  if (/step.?by.?step|granular|one at a time/.test(m)) return 'granular_build'
  if (/health|how (are|did)|performance|insight/.test(m)) return 'account_health'
  if (/create|launch|publish|new campaign|rsa/.test(m)) return 'search_launch'
  if (/display|rda|banner/.test(m)) return 'display_launch'
  if (/video|youtube/.test(m)) return 'video_launch'
  if (/shopping|merchant|product/.test(m)) return 'shopping_launch'
  if (/pmax|performance max|asset group/.test(m)) return 'pmax_launch'
  if (/app install|app campaign|multi.?channel/.test(m)) return 'app_launch'
  if (/local|store visit|gmb/.test(m)) return 'local_launch'
  return null
}

export function getGoogleSmartChain(chainId) {
  return GOOGLE_SMART_CHAINS.find((c) => c.id === chainId) || null
}

/** Tools that typically need platform_campaign_id in context. */
export const GOOGLE_CAMPAIGN_SCOPED_TOOLS = new Set([
  'google_create_ad_schedule',
  'google_set_bid_adjustments',
  'google_create_geo_targeting',
  'google_exclude_geo_targets',
  'google_add_negative_keywords',
  'google_suggest_negative_keywords',
  'google_get_location_performance',
  'google_optimize_geographic_targeting',
  'google_get_device_performance',
  'google_copy_campaign',
  'google_pause_campaign',
  'google_resume_campaign',
  'google_delete_campaign',
  'google_get_campaign',
  'google_list_ad_groups',
])

/** Tools that need platform_ad_set_id. */
export const GOOGLE_ADGROUP_SCOPED_TOOLS = new Set([
  'google_add_keywords',
  'google_create_ad',
  'google_add_audience_targeting',
  'google_list_keywords',
  'google_list_ads_read',
])
