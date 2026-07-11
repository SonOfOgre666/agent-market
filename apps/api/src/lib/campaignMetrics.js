/**
 * Single source for derived campaign KPI fields (CPA, ROAS) at persist time.
 */
export function enrichCampaignMetrics(metrics = {}) {
  const m = metrics && typeof metrics === 'object' ? { ...metrics } : {}
  const spend = Number(m.spend || 0)
  const conversions = Number(m.conversions || 0)
  const conversion_value = Number(
    m.conversion_value ?? m.conversions_value ?? m.revenue ?? 0,
  )
  const clicks = Number(m.clicks || 0)
  const impressions = Number(m.impressions || 0)

  return {
    ...m,
    impressions,
    clicks,
    spend,
    conversions,
    conversion_value,
    ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : Number(m.ctr || 0),
    cpc: clicks > 0 ? Math.round((spend / clicks) * 10000) / 10000 : Number(m.cpc || 0),
    cpa: conversions > 0 ? Math.round((spend / conversions) * 100) / 100 : Number(m.cpa || 0),
    roas: spend > 0 && conversion_value > 0
      ? Math.round((conversion_value / spend) * 100) / 100
      : 0,
  }
}
