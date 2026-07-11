/**
 * Canonical paid-ads platform keys for budget / KPI aggregation (API + UI).
 */
import { normalizeCampaignPlatformQuery } from '../constants/accountKinds.js'

export const BUDGET_PLATFORM_META = {
  google_ads: { label: 'Google Ads', color: '#4285f4' },
  meta_ads: { label: 'Meta Ads', color: '#1877f2' },
}

export const BUDGET_PLATFORM_KEYS = Object.keys(BUDGET_PLATFORM_META)

export function canonicalCampaignPlatform(platform) {
  const p = normalizeCampaignPlatformQuery(platform) || String(platform || '').toLowerCase()
  if (p === 'meta_ads' || p === 'meta' || p === 'facebook') return 'meta_ads'
  if (p === 'google_ads' || p === 'google') return 'google_ads'
  return p
}

export function aggregateCampaignsByPlatform(campaigns) {
  const byPlatform = {}
  for (const c of campaigns || []) {
    const key = canonicalCampaignPlatform(c.platform)
    if (!BUDGET_PLATFORM_META[key]) continue
    if (!byPlatform[key]) {
      byPlatform[key] = { budget: 0, spend: 0, clicks: 0, impressions: 0, conversions: 0 }
    }
    byPlatform[key].budget += c.budget?.amount || 0
    byPlatform[key].spend += c.metrics?.spend || 0
    byPlatform[key].clicks += c.metrics?.clicks || 0
    byPlatform[key].impressions += c.metrics?.impressions || 0
    byPlatform[key].conversions += c.metrics?.conversions || 0
  }
  return byPlatform
}

export function aggregateBudgetTotals(campaigns) {
  const items = campaigns || []
  const totalBudget = items.reduce((s, c) => s + (c.budget?.amount || 0), 0)
  const totalSpend = items.reduce((s, c) => s + (c.metrics?.spend || 0), 0)
  const totalImpressions = items.reduce((s, c) => s + (c.metrics?.impressions || 0), 0)
  const totalClicks = items.reduce((s, c) => s + (c.metrics?.clicks || 0), 0)
  const totalConversions = items.reduce((s, c) => s + (c.metrics?.conversions || 0), 0)
  const totalConversionValue = items.reduce(
    (s, c) => s + (c.metrics?.conversion_value || c.metrics?.conversions_value || 0),
    0,
  )
  const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0
  const cpc = totalClicks > 0 ? totalSpend / totalClicks : 0
  const cpa = totalConversions > 0 ? totalSpend / totalConversions : 0
  const portfolio_roas = totalSpend > 0 && totalConversionValue > 0
    ? totalConversionValue / totalSpend
    : 0

  return {
    total_budget: totalBudget,
    total_spend: totalSpend,
    budget_remaining: totalBudget - totalSpend,
    total_impressions: totalImpressions,
    total_clicks: totalClicks,
    total_conversions: totalConversions,
    total_conversion_value: Math.round(totalConversionValue * 100) / 100,
    portfolio_roas: Math.round(portfolio_roas * 100) / 100,
    ctr: Math.round(ctr * 100) / 100,
    cpc: Math.round(cpc * 100) / 100,
    cpa: Math.round(cpa * 100) / 100,
    campaign_count: items.length,
    active_campaigns: items.filter((c) => c.status === 'active').length,
    by_platform: aggregateCampaignsByPlatform(items),
  }
}
