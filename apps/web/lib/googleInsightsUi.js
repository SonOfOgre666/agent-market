/**
 * Google Ads reporting UI — maps to google_report_* tools (same registry path as the AI agent).
 */

export const GOOGLE_DATE_RANGES = [
  { value: 'LAST_7_DAYS', label: 'Last 7 days' },
  { value: 'LAST_30_DAYS', label: 'Last 30 days' },
  { value: 'LAST_90_DAYS', label: 'Last 90 days' },
]

/** Reporting views exposed in Performance explorer. */
export const GOOGLE_REPORT_VIEWS = [
  {
    id: 'performance',
    label: 'Campaign performance',
    api: 'googleCampaignPerformance',
    description: 'google_report_performance',
  },
  {
    id: 'account_summary',
    label: 'Account summary',
    api: 'googleAccountSummary',
    description: 'google_report_account_summary',
  },
  {
    id: 'ad_groups',
    label: 'Ad groups',
    api: 'googleAdGroups',
    description: 'google_report_ad_groups',
    needsCampaign: true,
  },
  {
    id: 'keywords',
    label: 'Keywords',
    api: 'googleKeywords',
    description: 'google_report_keywords',
    needsCampaign: true,
  },
  {
    id: 'ads',
    label: 'Ads (RSA)',
    api: 'googleAds',
    description: 'google_report_ads',
    needsCampaign: true,
  },
  {
    id: 'search_terms',
    label: 'Search terms',
    api: 'googleSearchTerms',
    description: 'google_report_search_terms',
    needsCampaign: true,
  },
]

export const DEFAULT_GOOGLE_INSIGHTS_QUERY = {
  view: 'performance',
  dateRange: 'LAST_30_DAYS',
  campaignId: '',
  status: '',
}

const VIEW_COLUMNS = {
  performance: [
    { key: 'campaign_name', label: 'Campaign' },
    { key: 'status', label: 'Status' },
    { key: 'impressions', label: 'Impressions', numeric: true },
    { key: 'clicks', label: 'Clicks', numeric: true },
    { key: 'cost', label: 'Spend', money: true },
    { key: 'ctr', label: 'CTR', percent: true },
    { key: 'conversions', label: 'Conv.', numeric: true },
    { key: 'cost_per_conversion', label: 'CPA', money: true },
  ],
  account_summary: [],
  ad_groups: [
    { key: 'ad_group_name', label: 'Ad group' },
    { key: 'campaign_name', label: 'Campaign' },
    { key: 'status', label: 'Status' },
    { key: 'impressions', label: 'Impressions', numeric: true },
    { key: 'clicks', label: 'Clicks', numeric: true },
    { key: 'cost', label: 'Spend', money: true },
    { key: 'conversions', label: 'Conv.', numeric: true },
  ],
  keywords: [
    { key: 'keyword_text', label: 'Keyword' },
    { key: 'match_type', label: 'Match' },
    { key: 'ad_group_name', label: 'Ad group' },
    { key: 'impressions', label: 'Impressions', numeric: true },
    { key: 'clicks', label: 'Clicks', numeric: true },
    { key: 'cost', label: 'Spend', money: true },
    { key: 'quality_score', label: 'QS' },
  ],
  ads: [
    { key: 'ad_id', label: 'Ad ID' },
    { key: 'ad_group_name', label: 'Ad group' },
    { key: 'status', label: 'Status' },
    { key: 'impressions', label: 'Impressions', numeric: true },
    { key: 'clicks', label: 'Clicks', numeric: true },
    { key: 'cost', label: 'Spend', money: true },
  ],
  search_terms: [
    { key: 'search_term', label: 'Search term' },
    { key: 'campaign_name', label: 'Campaign' },
    { key: 'impressions', label: 'Impressions', numeric: true },
    { key: 'clicks', label: 'Clicks', numeric: true },
    { key: 'cost', label: 'Spend', money: true },
  ],
}

export function columnsForGoogleView(viewId) {
  return VIEW_COLUMNS[viewId] || VIEW_COLUMNS.performance
}

export function buildGoogleReportParams(query, accountId) {
  const params = {
    account_id: accountId,
    date_range: query.dateRange || 'LAST_30_DAYS',
  }
  if (query.campaignId) params.campaign_id = query.campaignId
  if (query.status) params.status = query.status
  return params
}

export function formatGoogleCell(row, col) {
  const v = row[col.key]
  if (v == null || v === '') return '—'
  if (col.money) {
    return `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  if (col.percent) {
    const n = Number(v)
    const pct = n <= 1 ? n * 100 : n
    return `${pct.toFixed(2)}%`
  }
  if (col.numeric) return Number(v).toLocaleString()
  return String(v)
}

export function normalizeGoogleReportRows(viewId, res) {
  if (viewId === 'account_summary') return []
  const items = res?.items || res?.data?.payload || res?.data || []
  return Array.isArray(items) ? items : []
}

export function summaryFromAccountResponse(res) {
  if (!res) return null
  return res.total_cost != null || res.total_clicks != null ? res : res.data || res
}
