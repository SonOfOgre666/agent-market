/** Meta Ads insights UI helpers — /ads/performance (meta_report_insights only). */

export const META_TIME_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last_3d', label: 'Last 3 days' },
  { value: 'last_7d', label: 'Last 7 days' },
  { value: 'last_14d', label: 'Last 14 days' },
  { value: 'last_28d', label: 'Last 28 days' },
  { value: 'last_30d', label: 'Last 30 days' },
  { value: 'last_90d', label: 'Last 90 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'this_quarter', label: 'This quarter' },
  { value: 'last_quarter', label: 'Last quarter' },
  { value: 'this_year', label: 'This year' },
  { value: 'last_year', label: 'Last year' },
  { value: 'maximum', label: 'Maximum (all time)' },
  { value: 'last_week_mon_sun', label: 'Last week (Mon–Sun)' },
  { value: 'last_week_sun_sat', label: 'Last week (Sun–Sat)' },
  { value: 'this_week_mon_today', label: 'This week (Mon–today)' },
]

export const META_INSIGHT_LEVELS = [
  { value: 'account', label: 'Account' },
  { value: 'campaign', label: 'Campaign' },
  { value: 'adset', label: 'Ad set' },
  { value: 'ad', label: 'Ad' },
]

export const META_SCOPE_TYPES = [
  { value: 'account', label: 'Whole ad account' },
  { value: 'campaign', label: 'One campaign' },
  { value: 'adset', label: 'One ad set' },
  { value: 'ad', label: 'One ad' },
]

/** Common breakdowns (reference get_insights). */
export const META_BREAKDOWNS = [
  { value: '', label: 'None' },
  { value: 'age', label: 'Age' },
  { value: 'gender', label: 'Gender' },
  { value: 'country', label: 'Country' },
  { value: 'region', label: 'Region' },
  { value: 'dma', label: 'DMA' },
  { value: 'device_platform', label: 'Device platform' },
  { value: 'publisher_platform', label: 'Publisher platform' },
  { value: 'platform_position', label: 'Platform position (+ publisher_platform auto)' },
  { value: 'impression_device', label: 'Impression device' },
  { value: 'media_type', label: 'Media type (DCO)' },
]

export const META_ATTRIBUTION_WINDOWS = [
  '1d_click',
  '7d_click',
  '28d_click',
  '1d_view',
  '7d_view',
  '28d_view',
]

export const META_ACTION_BREAKDOWN_MODES = [
  { value: 'default', label: 'Default (action_type)' },
  { value: 'empty', label: 'None ([]) — required for some breakdowns' },
  { value: 'custom', label: 'Custom (comma-separated)' },
]

const CORE_METRIC_KEYS = [
  'impressions',
  'clicks',
  'spend',
  'reach',
  'frequency',
  'ctr',
  'cpc',
  'cpm',
  'unique_clicks',
]

const ID_NAME_KEYS = [
  'account_id',
  'account_name',
  'campaign_id',
  'campaign_name',
  'adset_id',
  'adset_name',
  'ad_id',
  'ad_name',
  'date_start',
  'date_stop',
]

const JSON_ARRAY_KEYS = ['actions', 'action_values', 'conversions', 'cost_per_action_type']

const BREAKDOWN_DIMENSION_KEYS = new Set([
  'age',
  'gender',
  'country',
  'region',
  'dma',
  'device_platform',
  'publisher_platform',
  'platform_position',
  'impression_device',
  'media_type',
])

export function metaActId(adAccountId) {
  if (!adAccountId) return null
  const s = String(adAccountId).trim()
  if (s.startsWith('act_')) return s
  const digits = s.replace(/\D/g, '')
  return digits ? `act_${digits}` : null
}

export function buildMetaInsightsQuery({
  actId,
  query,
  objectIdOverride,
  afterCursor,
}) {
  const q = { ...query }
  const params = { account_id: q.mongoAccountId, limit: q.limit || 100 }

  if (objectIdOverride) {
    params.object_id = objectIdOverride
  } else if (q.scope === 'account') {
    params.object_id = actId
  } else if (q.scope === 'campaign' && q.scopeCampaignId) {
    params.object_id = q.scopeCampaignId
  } else if (q.scope === 'adset' && q.scopeAdsetId) {
    params.object_id = q.scopeAdsetId
  } else if (q.scope === 'ad' && q.scopeAdId) {
    params.object_id = q.scopeAdId
  } else {
    params.object_id = actId
  }

  if (q.timeMode === 'custom' && q.since && q.until) {
    params.since = q.since
    params.until = q.until
  } else {
    params.time_range = q.timePreset || 'last_30d'
  }

  params.level = q.level || 'campaign'
  if (q.breakdown) params.breakdown = q.breakdown
  if (q.compact) params.compact = '1'
  if (q.apiVersion) params.api_version = q.apiVersion
  if (q.actionAttribution?.length) {
    params.action_attribution_windows = q.actionAttribution.join(',')
  }
  if (q.actionBreakdownsMode === 'empty') {
    params.action_breakdowns = '__empty__'
  } else if (q.actionBreakdownsMode === 'custom' && q.actionBreakdownsCustom?.trim()) {
    params.action_breakdowns = q.actionBreakdownsCustom.trim()
  }
  if (afterCursor) params.after = afterCursor

  return params
}

export function summarizeJsonMetric(val) {
  if (val == null) return '—'
  if (!Array.isArray(val)) return String(val)
  if (val.length === 0) return '—'
  const top = val.slice(0, 3).map((item) => {
    const type = item.action_type || item.conversion_type || item.type || '—'
    const v = item.value ?? item.count ?? ''
    return `${type}:${v}`
  })
  const more = val.length > 3 ? ` +${val.length - 3}` : ''
  return top.join(', ') + more
}

export function collectInsightColumns(rows, breakdown) {
  const keys = new Set()
  for (const row of rows || []) {
    if (!row || typeof row !== 'object') continue
    Object.keys(row).forEach((k) => keys.add(k))
  }
  const breakdownKeys = breakdown
    ? breakdown.split(',').map((b) => b.trim()).filter(Boolean)
    : []
  for (const k of breakdownKeys) keys.add(k)

  const cols = []
  const push = (key, label) => {
    if (keys.has(key) || breakdownKeys.includes(key)) cols.push({ key, label })
  }

  for (const k of breakdownKeys) push(k, k)
  for (const k of ID_NAME_KEYS) push(k, k.replace(/_/g, ' '))
  for (const k of CORE_METRIC_KEYS) push(k, k)
  for (const k of JSON_ARRAY_KEYS) push(k, k.replace(/_/g, ' '))

  for (const k of keys) {
    if (
      BREAKDOWN_DIMENSION_KEYS.has(k) &&
      !cols.some((c) => c.key === k)
    ) {
      cols.push({ key: k, label: k })
    }
  }

  return cols
}

export function formatInsightCell(key, val, fmt$) {
  if (val == null || val === '') return '—'
  if (JSON_ARRAY_KEYS.includes(key)) return summarizeJsonMetric(val)
  if (key === 'spend' || key === 'cpc' || key === 'cpm') return fmt$(val)
  if (key === 'ctr' && val != null) return `${Number(val).toFixed(2)}%`
  if (typeof val === 'number') return Number(val).toLocaleString()
  return String(val)
}

export const DEFAULT_META_INSIGHTS_QUERY = {
  timeMode: 'preset',
  timePreset: 'last_30d',
  since: '',
  until: '',
  scope: 'account',
  scopeCampaignId: '',
  scopeAdsetId: '',
  scopeAdId: '',
  level: 'campaign',
  breakdown: '',
  actionAttribution: [],
  actionBreakdownsMode: 'default',
  actionBreakdownsCustom: 'action_type',
  compact: true,
  limit: 100,
  apiVersion: 'v22.0',
}
