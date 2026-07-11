export const SENTIMENT_STYLE = {
  positive: { color: 'var(--success)', label: 'Positive' },
  negative: { color: 'var(--danger)', label: 'Negative' },
  neutral: { color: 'var(--fg-muted)', label: 'Neutral' },
  mixed: { color: 'var(--warning)', label: 'Mixed' },
}

export const PROVIDER_LABEL = {
  facebook: 'Facebook',
  facebook_page: 'Facebook',
  instagram: 'Instagram',
  instagram_login: 'Instagram',
  twitter: 'X / Twitter',
  linkedin: 'LinkedIn',
  tiktok: 'TikTok',
}

export const PROVIDER_COLOR = {
  facebook: '#1877f2',
  facebook_page: '#1877f2',
  instagram: '#e1306c',
  instagram_login: '#e1306c',
  twitter: '#1d9bf0',
  linkedin: '#0a66c2',
  tiktok: '#ff0050',
}

/** Providers where comment sync + reply are implemented. */
export const COMMENT_SYNC_SUPPORTED_PROVIDERS = new Set([
  'facebook',
  'facebook_page',
  'instagram',
  'instagram_login',
  'twitter',
  'linkedin',
])

/** Platforms you can publish to but cannot auto-sync comments from. */
export const COMMENT_SYNC_UNSUPPORTED = [
  {
    provider: 'tiktok',
    label: 'TikTok',
    reason: 'TikTok’s Content API supports publishing only — there is no API to pull or reply to comments.',
  },
]

/** Supported platforms with extra user-facing caveats. */
export const COMMENT_SYNC_LIMITATIONS = [
  {
    provider: 'twitter',
    label: 'X / Twitter',
    note: 'Conversation search needs X API Basic tier or higher (not available on Free).',
  },
  {
    provider: 'linkedin',
    label: 'LinkedIn',
    note: 'Comment sync needs Community Management API on your LinkedIn app (r_member_social_feed). Reconnect the account after approval.',
  },
]

export function isCommentSyncSupported(provider) {
  return COMMENT_SYNC_SUPPORTED_PROVIDERS.has(String(provider || '').toLowerCase())
}

export function commentSyncSupportedLabel() {
  return 'Facebook, Instagram, X / Twitter, and LinkedIn'
}

export function commentSyncUnsupportedLabels() {
  return COMMENT_SYNC_UNSUPPORTED.map((p) => p.label).join(', ')
}

export function uniqueProviderLabels(providers) {
  const seen = new Set()
  const labels = []
  for (const p of providers) {
    const key = String(p || '').toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    labels.push(PROVIDER_LABEL[key] || key)
  }
  return labels
}

