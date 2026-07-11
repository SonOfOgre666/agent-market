/** Meta objective / optimization_goal rules (sync with publish_defaults.py). */

export const GOALS_REQUIRING_VIDEO = new Set(['THRUPLAY', 'TWO_SECOND_CONTINUOUS_VIDEO_VIEWS'])

const WEBSITE_LINK_OBJECTIVES = new Set(['OUTCOME_TRAFFIC', 'OUTCOME_SALES', 'OUTCOME_LEADS'])

export const LEADS_FORM_GOALS = new Set(['LEAD_GENERATION', 'QUALITY_LEAD'])

export const SALES_CONVERSION_GOALS = new Set(['OFFSITE_CONVERSIONS', 'VALUE'])

const APP_PROMOTION_OBJECTIVE = 'OUTCOME_APP_PROMOTION'

export function goalRequiresVideo(optimizationGoal) {
  return GOALS_REQUIRING_VIDEO.has(String(optimizationGoal || '').trim().toUpperCase())
}

export function objectiveSupportsWebsiteDestination(objective) {
  return WEBSITE_LINK_OBJECTIVES.has(String(objective || '').trim().toUpperCase())
}

/** Meta ODAX destination_type for Engagement ad sets (never WEBSITE). */
export function engagementDestinationType(optimizationGoal, hasVideo = false) {
  const og = String(optimizationGoal || 'POST_ENGAGEMENT').trim().toUpperCase()
  if (GOALS_REQUIRING_VIDEO.has(og) || hasVideo) return 'ON_VIDEO'
  return 'ON_POST'
}

export function isEngagementObjective(objective) {
  return String(objective || '').trim().toUpperCase() === 'OUTCOME_ENGAGEMENT'
}

export function isAppPromotionObjective(objective) {
  return String(objective || '').trim().toUpperCase() === APP_PROMOTION_OBJECTIVE
}

export function goalRequiresLeadForm(optimizationGoal) {
  return LEADS_FORM_GOALS.has(String(optimizationGoal || '').trim().toUpperCase())
}

export function goalRequiresPixel(objective, optimizationGoal) {
  const obj = String(objective || '').trim().toUpperCase()
  const og = String(optimizationGoal || '').trim().toUpperCase()
  return obj === 'OUTCOME_SALES' && SALES_CONVERSION_GOALS.has(og)
}

export function goalRequiresAppStore(objective) {
  return isAppPromotionObjective(objective)
}

/** Legacy drafts may still store IMPRESSIONS; publish maps it to REACH for Engagement/Awareness. */
export function impressionsGoalDeprecated(objective) {
  const obj = String(objective || '').trim().toUpperCase()
  return obj === 'OUTCOME_ENGAGEMENT' || obj === 'OUTCOME_AWARENESS'
}

export function optimizationGoalHint(optimizationGoal, objective) {
  const og = String(optimizationGoal || '').trim().toUpperCase()
  const obj = String(objective || '').trim().toUpperCase()
  if (og === 'IMPRESSIONS' && impressionsGoalDeprecated(objective)) {
    return 'Impressions as an optimization goal is no longer supported by Meta for this objective. Choose Reach or Post engagement.'
  }
  if (isEngagementObjective(objective)) {
    return (
      'Engagement publishes with destination ON_POST (or ON_VIDEO for ThruPlay). ' +
      'Link URL is used as the ad CTA. For website-only traffic, use the Traffic objective.'
    )
  }
  if (goalRequiresVideo(optimizationGoal)) {
    return 'ThruPlay requires a video on the creative step. Link URL is optional (used for CTA).'
  }
  if (goalRequiresLeadForm(optimizationGoal)) {
    return 'Lead form ads use destination ON_AD. You need a Meta Instant Form ID (from Ads Manager) and a Facebook Page.'
  }
  if (goalRequiresPixel(objective, optimizationGoal)) {
    return 'Sales conversions require a Meta Pixel ID (Events Manager). Use Traffic objective for simple link-click ads.'
  }
  if (goalRequiresAppStore(objective)) {
    return 'App promotion requires your Facebook app ID and App Store / Play Store URL on the ad set (promoted_object).'
  }
  if (obj === 'OUTCOME_SALES' && og === 'LINK_CLICKS') {
    return 'Link clicks are not valid for Sales on Meta. Use Traffic objective instead.'
  }
  return null
}

/**
 * Pre-publish validation (mirrors publish_defaults.validate_publish_configuration).
 * @returns {string|null} error message
 */
export function validateMetaPublishConfiguration(values) {
  const objective = String(values.objective || '').trim().toUpperCase()
  const og = String(values.optimization_goal || '').trim().toUpperCase()
  const pageId = String(values.page_id || '').trim()
  const leadFormId = String(values.lead_gen_form_id || '').trim()
  const pixelId = String(values.pixel_id || '').trim()
  const appId = String(values.application_id || '').trim()
  const storeUrl = String(values.object_store_url || '').trim()
  const hasVideo = Boolean(values.video_id || values.video_url)

  if (goalRequiresVideo(og) && !hasVideo) {
    return `${og} requires a video creative (upload via meta_upload_ad_video).`
  }

  if (objective === 'OUTCOME_SALES' && og === 'LINK_CLICKS') {
    return 'LINK_CLICKS is not valid for Sales campaigns. Use Traffic for link clicks, or Conversions with a Pixel.'
  }

  if (goalRequiresLeadForm(og)) {
    if (!pageId) return 'Select a Facebook Page for lead form ads.'
    if (!leadFormId) {
      return 'Lead form goal requires a Meta Instant Form ID (create in Ads Manager → Instant forms).'
    }
    const lower = leadFormId.toLowerCase()
    if (lower.startsWith('http://') || lower.startsWith('https://') || leadFormId.includes('/')) {
      return 'Instant Form ID must be numeric digits only — not a website URL. Find it in Ads Manager → Instant forms.'
    }
    if (!/^\d+$/.test(leadFormId.replace(/\s/g, ''))) {
      return 'Instant Form ID must be numeric (e.g. 123456789012345).'
    }
  }

  if (goalRequiresPixel(objective, og) && !pixelId) {
    return 'Sales conversion goals require a Meta Pixel ID (Events Manager).'
  }

  if (goalRequiresAppStore(objective)) {
    if (!appId) return 'App promotion requires application_id (Facebook app ID).'
    if (!storeUrl) return 'App promotion requires object_store_url (App Store or Google Play URL).'
    if (!/apps\.apple\.com|play\.google\.com|itunes\.apple\.com/.test(storeUrl)) {
      return 'object_store_url must be an App Store or Google Play link.'
    }
  }

  return null
}
