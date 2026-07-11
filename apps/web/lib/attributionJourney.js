/**
 * Client-side multi-touch journey (localStorage) for landing-page conversions.
 */
const STORAGE_KEY = 'am_attribution_journey'
const MAX_TOUCHES = 20

function normalizeUtm(utm = {}) {
  return {
    utm_source: utm.utm_source || utm.source || '',
    utm_medium: utm.utm_medium || utm.medium || '',
    utm_campaign: utm.utm_campaign || utm.campaign || '',
    utm_term: utm.utm_term || utm.term || '',
    utm_content: utm.utm_content || utm.content || '',
  }
}

export function getAttributionJourney() {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function recordAttributionTouch(utm, { landing_page: landingPage } = {}) {
  if (typeof window === 'undefined') return getAttributionJourney()
  const normalized = normalizeUtm(utm)
  const hasSignal = Object.values(normalized).some(Boolean) || landingPage
  if (!hasSignal) return getAttributionJourney()

  const touch = {
    at: new Date().toISOString(),
    ...normalized,
    landing_page: landingPage || null,
  }
  const prev = getAttributionJourney()
  const last = prev[prev.length - 1]
  const dup = last
    && last.utm_source === touch.utm_source
    && last.utm_medium === touch.utm_medium
    && last.utm_campaign === touch.utm_campaign
    && last.landing_page === touch.landing_page
  const next = dup ? prev : [...prev, touch].slice(-MAX_TOUCHES)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

export function clearAttributionJourney() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(STORAGE_KEY)
}
