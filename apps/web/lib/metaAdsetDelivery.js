/**
 * Meta ad set billing_event × optimization_goal (Graph error_subcode 1815117).
 * Keep in sync with services/ai-worker/connectors/meta_ads/publish_defaults.py
 *
 * Ads Manager (Traffic + link clicks): optimize for LINK_CLICKS, bill by LINK_CLICKS or IMPRESSIONS.
 * Other goals (REACH, LANDING_PAGE_VIEWS, …): IMPRESSIONS billing only.
 */

const GOALS_ALLOW_BOTH_BILLING = new Set(['LINK_CLICKS'])

export function billingOptionsForGoal(optimizationGoal) {
  const og = String(optimizationGoal || '').trim().toUpperCase()
  if (GOALS_ALLOW_BOTH_BILLING.has(og)) {
    return [
      { value: 'IMPRESSIONS', label: 'Impressions (CPM while optimizing for clicks)' },
      { value: 'LINK_CLICKS', label: 'Link clicks (CPC)' },
    ]
  }
  return [{ value: 'IMPRESSIONS', label: 'Impressions' }]
}

export function resolveBillingEventForGoal(optimizationGoal, billingEvent) {
  const og = String(optimizationGoal || 'LINK_CLICKS').trim().toUpperCase()
  let be = String(billingEvent || 'IMPRESSIONS').trim().toUpperCase()
  if (be !== 'IMPRESSIONS' && be !== 'LINK_CLICKS') be = 'IMPRESSIONS'
  if (GOALS_ALLOW_BOTH_BILLING.has(og)) return be
  return 'IMPRESSIONS'
}

export function billingEventLabel(billingEvent) {
  return billingEvent === 'LINK_CLICKS' ? 'Link clicks' : 'Impressions'
}

export function formatMetaReviewValue(value) {
  if (value == null || value === '') return ''
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === 'object') {
          return item.name || item.id || JSON.stringify(item)
        }
        return String(item)
      })
      .join(', ')
  }
  if (typeof value === 'object') {
    return value.name || value.id || JSON.stringify(value)
  }
  return String(value)
}
