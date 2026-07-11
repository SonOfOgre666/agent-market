/**
 * Google Ads advertising channel types — full end-to-end publish per type.
 * AdvertisingChannelTypeEnum: SEARCH, DISPLAY, SHOPPING, VIDEO, PERFORMANCE_MAX, LOCAL, MULTI_CHANNEL (App)
 */

export const GOOGLE_CAMPAIGN_TYPES = [
  {
    value: 'search',
    api: 'SEARCH',
    label: 'Search',
    description: 'Full publish: budget → campaign → ad group → keywords → RSA.',
    publishMode: 'full',
    publishTool: 'google_publish_search_campaign',
    needsKeywords: true,
    needsRsa: true,
    needsAdGroup: true,
  },
  {
    value: 'display',
    api: 'DISPLAY',
    label: 'Display',
    description: 'Full publish: budget → campaign → ad group → responsive display ad.',
    publishMode: 'full',
    publishTool: 'google_publish_display_campaign',
    needsKeywords: false,
    needsRsa: false,
    needsAdGroup: true,
  },
  {
    value: 'video',
    api: 'VIDEO',
    label: 'Video',
    description: 'VIDEO_ACTION + VideoResponsiveAd (logo + YouTube video required).',
    publishMode: 'full',
    publishTool: 'google_publish_video_campaign',
    needsKeywords: false,
    needsRsa: false,
    needsAdGroup: true,
    needsLogo: true,
  },
  {
    value: 'shopping',
    api: 'SHOPPING',
    label: 'Shopping',
    description: 'Full publish: budget → shopping campaign → ad group → all-products partition. Requires Merchant Center.',
    publishMode: 'full',
    publishTool: 'google_publish_shopping_campaign',
    needsKeywords: false,
    needsRsa: false,
    needsAdGroup: true,
  },
  {
    value: 'performance_max',
    api: 'PERFORMANCE_MAX',
    label: 'Performance Max',
    description: 'Atomic asset group publish: 3+ headlines, 2+ descriptions, logo + marketing/square images.',
    publishMode: 'full',
    publishTool: 'google_publish_performance_max_campaign',
    needsKeywords: false,
    needsRsa: false,
    needsAdGroup: false,
    needsLogo: true,
    needsMarketingImages: true,
  },
  {
    value: 'app',
    api: 'MULTI_CHANNEL',
    label: 'App',
    description: 'Full publish: budget → app campaign → ad group → app ad.',
    publishMode: 'full',
    publishTool: 'google_publish_app_campaign',
    needsKeywords: false,
    needsRsa: false,
    needsAdGroup: true,
  },
  {
    value: 'local',
    api: 'LOCAL',
    label: 'Local (→ PMax)',
    description: 'Deprecated LOCAL channel — routes to Performance Max per Google upgrade policy.',
    publishMode: 'full',
    publishTool: 'google_publish_local_campaign',
    routesTo: 'performance_max',
    needsKeywords: false,
    needsRsa: false,
    needsAdGroup: false,
    needsLogo: true,
    needsMarketingImages: true,
  },
]

export const GOOGLE_CAMPAIGN_TYPE_BY_VALUE = Object.fromEntries(
  GOOGLE_CAMPAIGN_TYPES.map((t) => [t.value, t]),
)

export function normalizeCampaignType(raw) {
  const s = String(raw || 'search').trim().toLowerCase().replace(/-/g, '_')
  if (s === 'performance_max' || s === 'pmax' || s === 'performance max') return 'performance_max'
  if (s === 'multi_channel') return 'app'
  return GOOGLE_CAMPAIGN_TYPE_BY_VALUE[s] ? s : 'search'
}

export function campaignTypeMeta(raw) {
  return GOOGLE_CAMPAIGN_TYPE_BY_VALUE[normalizeCampaignType(raw)] || GOOGLE_CAMPAIGN_TYPES[0]
}

export function isSearchCampaignType(raw) {
  return normalizeCampaignType(raw) === 'search'
}

export function googlePublishToolForType(raw) {
  return campaignTypeMeta(raw).publishTool || 'google_publish_campaign'
}
