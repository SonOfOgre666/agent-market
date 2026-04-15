import { TwitterProvider } from './twitter.js'
import { MetaProvider } from './meta.js'
import { MastodonProvider } from './mastodon.js'
import { TikTokProvider } from './tiktok.js'
import { LinkedInProvider } from './linkedin.js'
import { InstagramLoginProvider } from './instagram_login.js'
import { GoogleAdsProvider } from './google_ads.js'
import * as Service from '../models/Service.js'

// facebook_page and instagram both use MetaProvider but with different callbackType
// so they build different callback URLs and filter different entity types
const PROVIDERS = {
  twitter:         { Class: TwitterProvider,        configKey: 'twitter',         callbackType: null },
  facebook_page:   { Class: MetaProvider,           configKey: 'facebook',        callbackType: 'facebook_page' },
  instagram:       { Class: MetaProvider,           configKey: 'facebook',        callbackType: 'instagram' },
  facebook:        { Class: MetaProvider,           configKey: 'facebook',        callbackType: 'facebook_page' }, // legacy alias
  mastodon:        { Class: MastodonProvider,       configKey: 'mastodon',        callbackType: null },
  tiktok:          { Class: TikTokProvider,         configKey: 'tiktok',          callbackType: null },
  linkedin:        { Class: LinkedInProvider,       configKey: 'linkedin',        callbackType: null },
  instagram_login: { Class: InstagramLoginProvider, configKey: 'instagram_login', callbackType: null },
  google_ads:      { Class: GoogleAdsProvider,      configKey: 'google_ads',      callbackType: null },
}

export async function getSocialProvider(providerName, options = {}, account = null) {
  const entry = PROVIDERS[providerName]
  if (!entry) throw new Error(`Unknown provider: ${providerName}`)

  const config = await Service.getDecryptedConfig(entry.configKey)
  const merged = { ...config, ...options, ...(entry.callbackType ? { callbackType: entry.callbackType } : {}) }
  return new entry.Class(merged, account)
}
