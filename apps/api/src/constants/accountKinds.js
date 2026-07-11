/** Social publishing (pages/profiles) — never used for paid ads workflows. */
export const SOCIAL_PROVIDERS = [
  'twitter',
  'facebook',
  'instagram',
  'instagram_login',
  'tiktok',
  'linkedin',
]

/** Paid ads platforms only (canonical). */
export const ADS_PROVIDERS = ['google_ads', 'meta_ads']

/** Legacy campaign platform strings mapped for display/sync only. */
export const LEGACY_ADS_PLATFORM_ALIASES = ['meta', 'facebook']

export const ADS_CAMPAIGN_PLATFORMS = ['google_ads', 'meta_ads']

export function isSocialProvider(provider) {
  return SOCIAL_PROVIDERS.includes(provider)
}

export function isAdsProvider(provider) {
  return ADS_PROVIDERS.includes(provider)
}

export function isAdsCampaignPlatform(platform) {
  return ADS_CAMPAIGN_PLATFORMS.includes(platform) || LEGACY_ADS_PLATFORM_ALIASES.includes(platform)
}

/** Map URL/legacy platform query values to canonical campaign platform. */
export function normalizeCampaignPlatformQuery(platform) {
  if (!platform) return null
  const p = String(platform).trim().toLowerCase()
  if (p === 'meta' || p === 'facebook') return 'meta_ads'
  if (p === 'google') return 'google_ads'
  if (ADS_CAMPAIGN_PLATFORMS.includes(p)) return p
  return platform
}

export function filterAccountsByKind(accounts, kind) {
  if (kind === 'social') {
    return accounts.filter((a) => isSocialProvider(a.provider))
  }
  if (kind === 'ads') {
    return accounts.filter((a) => isAdsProvider(a.provider))
  }
  return accounts
}
