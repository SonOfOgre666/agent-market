/** Social publishing (pages/profiles) — post composer & calendar only. */
export const SOCIAL_PROVIDERS = [
  'twitter',
  'facebook',
  'instagram',
  'instagram_login',
  'tiktok',
  'linkedin',
]

/** Paid ads platforms only. */
export const ADS_PROVIDERS = ['google_ads', 'meta_ads']

export const ADS_CAMPAIGN_PLATFORMS = ['google_ads', 'meta_ads']

export function isSocialProvider(provider) {
  return SOCIAL_PROVIDERS.includes(provider)
}

/** User-facing provider slug in account lists (instagram_login → instagram). */
export function socialProviderSlug(provider) {
  if (provider === 'instagram_login') return 'instagram'
  if (provider === 'facebook_page') return 'facebook'
  return provider
}

/** Label shown next to @username in Connected Accounts / account lists. */
export function accountProviderLabel(provider) {
  if (provider === 'google_ads') return 'Google Ads'
  if (provider === 'meta_ads') return 'Meta Ads'
  return socialProviderSlug(provider)
}

export function isAdsProvider(provider) {
  return ADS_PROVIDERS.includes(provider)
}

/** TikTok Content Posting API accepts video only. */
export function canSelectAccountForPost(account, { videoPost = false } = {}) {
  if (!account) return false
  if (account.provider === 'tiktok') return videoPost
  return true
}

export function filterSelectableAccountIds(accountIds, accounts, options = {}) {
  const byId = new Map((accounts || []).map(a => [a.id, a]))
  return (accountIds || []).filter(id => canSelectAccountForPost(byId.get(id), options))
}
