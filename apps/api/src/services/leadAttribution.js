/**
 * Lead attribution — first-touch, last-touch, and linear multi-touch (§9.6).
 */
import { getDb } from '../lib/mongo.js'

const ATTRIBUTION_MODELS = new Set(['first_touch', 'last_touch', 'linear'])
export const ATTRIBUTION_COOKIE = 'am_attr_journey'
export const MAX_ATTRIBUTION_TOUCHES = 20

function touchDedupeKey(touch) {
  const t = touch || {}
  return [
    t.utm_source || t.source || '',
    t.utm_medium || t.medium || '',
    t.utm_campaign || t.campaign || '',
    t.landing_page || '',
  ].join('|')
}

export function normalizeLeadTouch(utm = {}, { landing_page: landingPage } = {}) {
  return {
    at: new Date().toISOString(),
    utm_source: utm.utm_source || utm.source || '',
    utm_medium: utm.utm_medium || utm.medium || '',
    utm_campaign: utm.utm_campaign || utm.campaign || '',
    utm_term: utm.utm_term || utm.term || '',
    utm_content: utm.utm_content || utm.content || '',
    landing_page: landingPage || null,
  }
}

export function mergeLeadTouchpoints(...groups) {
  const merged = []
  for (const group of groups) {
    if (!Array.isArray(group)) continue
    for (const touch of group) {
      if (!touch || typeof touch !== 'object') continue
      const normalized = {
        ...touch,
        at: touch.at || new Date().toISOString(),
      }
      const last = merged[merged.length - 1]
      if (last && touchDedupeKey(last) === touchDedupeKey(normalized)) continue
      merged.push(normalized)
    }
  }
  return merged.slice(-MAX_ATTRIBUTION_TOUCHES)
}

export function parseAttributionCookie(raw) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function resolveLeadTouchpoints({
  clientTouchpoints,
  cookieTouchpoints,
  utm,
  landingPageSlug,
}) {
  const serverTouch = normalizeLeadTouch(utm, { landing_page: landingPageSlug })
  const hasSignal = Boolean(
    serverTouch.utm_source
    || serverTouch.utm_medium
    || serverTouch.utm_campaign
    || serverTouch.landing_page,
  )
  const merged = mergeLeadTouchpoints(cookieTouchpoints, clientTouchpoints)
  if (hasSignal) return mergeLeadTouchpoints(merged, [serverTouch])
  return merged.length ? merged : null
}

function utmFromTouch(touch) {
  const t = touch || {}
  return {
    source: t.utm_source || t.source || '(direct)',
    campaign: t.utm_campaign || t.campaign || '(none)',
    medium: t.utm_medium || t.medium || '(none)',
    content: t.utm_content || t.content || '',
    landing_page: t.landing_page || t.landing_page_slug || null,
  }
}

export function touchpointsForLead(lead) {
  if (Array.isArray(lead.touchpoints) && lead.touchpoints.length) {
    return lead.touchpoints
  }
  const utm = lead.utm || {}
  if (Object.keys(utm).length) {
    return [{
      at: lead.created_at,
      utm_source: utm.utm_source || utm.source,
      utm_medium: utm.utm_medium || utm.medium,
      utm_campaign: utm.utm_campaign || utm.campaign,
      utm_term: utm.utm_term || utm.term,
      utm_content: utm.utm_content || utm.content,
      landing_page: lead.landing_page_slug || null,
    }]
  }
  return [{
    at: lead.created_at,
    utm_source: '(direct)',
    landing_page: lead.landing_page_slug || null,
  }]
}

function weightedTouches(touches, model) {
  if (!touches.length) return []
  if (model === 'first_touch') {
    return [{ touch: touches[0], credit: 1 }]
  }
  if (model === 'last_touch') {
    return [{ touch: touches[touches.length - 1], credit: 1 }]
  }
  const credit = 1 / touches.length
  return touches.map((touch) => ({ touch, credit }))
}

function addCredit(bucket, key, credit) {
  if (!key) return
  bucket[key] = (bucket[key] || 0) + credit
}

function toSorted(obj, useCredit = false) {
  return Object.entries(obj)
    .map(([key, value]) => ({
      key,
      count: useCredit ? undefined : value,
      credit: useCredit ? Math.round(value * 1000) / 1000 : undefined,
    }))
    .sort((a, b) => (b.credit ?? b.count ?? 0) - (a.credit ?? a.count ?? 0))
}

export async function summarizeLeadAttribution(workspaceId, {
  days = 90,
  model = 'first_touch',
} = {}) {
  const attributionModel = ATTRIBUTION_MODELS.has(model) ? model : 'first_touch'
  const since = new Date(Date.now() - days * 86400000)
  const leads = await getDb().collection('ads_leads').find({
    workspace_id: String(workspaceId),
    created_at: { $gte: since },
  }).toArray()

  const bySource = {}
  const byCampaign = {}
  const byLandingPage = {}
  const byMedium = {}
  const journeys = []
  const useCredit = attributionModel === 'linear'

  for (const lead of leads) {
    const touches = touchpointsForLead(lead)
    const weighted = weightedTouches(touches, attributionModel)
    journeys.push({
      lead_id: lead._id?.toString(),
      touch_count: touches.length,
      touches: touches.map((t) => ({
        utm_source: t.utm_source || t.source,
        utm_campaign: t.utm_campaign || t.campaign,
        utm_medium: t.utm_medium || t.medium,
        landing_page: t.landing_page || lead.landing_page_slug,
        at: t.at,
      })),
    })

    for (const { touch, credit } of weighted) {
      const u = utmFromTouch(touch)
      const lp = u.landing_page || lead.landing_page_slug || '(unknown)'
      if (useCredit) {
        addCredit(bySource, u.source, credit)
        addCredit(byCampaign, u.campaign, credit)
        addCredit(byMedium, u.medium, credit)
        addCredit(byLandingPage, lp, credit)
      } else {
        bySource[u.source] = (bySource[u.source] || 0) + 1
        byCampaign[u.campaign] = (byCampaign[u.campaign] || 0) + 1
        byMedium[u.medium] = (byMedium[u.medium] || 0) + 1
        byLandingPage[lp] = (byLandingPage[lp] || 0) + 1
      }
    }
  }

  return {
    workspace_id: String(workspaceId),
    period_days: days,
    model: attributionModel,
    total_leads: leads.length,
    multi_touch_leads: journeys.filter((j) => j.touch_count > 1).length,
    by_source: toSorted(bySource, useCredit),
    by_campaign: toSorted(byCampaign, useCredit),
    by_medium: toSorted(byMedium, useCredit),
    by_landing_page: toSorted(byLandingPage, useCredit),
    sample_journeys: journeys.filter((j) => j.touch_count > 1).slice(0, 10),
  }
}
