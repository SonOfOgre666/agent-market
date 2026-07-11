/**
 * X (Twitter) — OAuth 1.0a + v2 API.
 *
 * OAuth (API): getAuthUrl, handleCallback.
 * Execution: getAccount, getExternalPostUrl. **Publishing** — worker only (`tasks.social.publish_post` → `connectors.twitter`).
 */
import { TwitterApi } from 'twitter-api-v2'
import * as Account from '../models/Account.js'

// Character limits per tier
const CHAR_LIMITS = { legacy: 140, free: 280, basic: 280, pay_as_you_go: 280 }

const TWITTER_OAUTH_KEY = (oauth_token) => `twitter:oauth:${oauth_token}`

/** OAuth 1.0a does not round-trip `state`; persist workspace context by request token. */
export async function loadTwitterOAuthSession(oauth_token) {
  if (!oauth_token) return null
  const { getRedis } = await import('../lib/redis.js')
  const raw = await getRedis().get(TWITTER_OAUTH_KEY(oauth_token))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && parsed.oauth_token_secret) return parsed
  } catch {
    // Legacy value: oauth_token_secret string only
    return { oauth_token_secret: raw }
  }
  return null
}

export class TwitterProvider {
  constructor(config = {}, account = null) {
    this.config = config
    this.account = account
    this.appKey = config.client_id || config.app_key
    this.appSecret = config.client_secret || config.app_secret
    this.tier = config.tier || 'free'
    this.callbackUrl = process.env.TWITTER_CALLBACK_URL || `${process.env.API_URL || 'http://localhost:4010'}/callback/twitter`
    
    console.log('[TwitterProvider] Initialized with:', {
      hasAppKey: !!this.appKey,
      appKeyPreview: this.appKey ? this.appKey.slice(0, 10) + '...' : 'MISSING',
      hasAppSecret: !!this.appSecret,
      appSecretPreview: this.appSecret ? this.appSecret.slice(0, 10) + '...' : 'MISSING',
      callbackUrl: this.callbackUrl,
    })
  }

  // --- OAuth 1.0a flow (used for write access) ---
  async getAuthUrl({ workspaceId = null, userId = null, return_to = '/accounts' } = {}) {
    const client = new TwitterApi({ appKey: this.appKey, appSecret: this.appSecret })
    const { url, oauth_token, oauth_token_secret } = await client.generateAuthLink(this.callbackUrl)
    const { getRedis } = await import('../lib/redis.js')
    await getRedis().setex(
      TWITTER_OAUTH_KEY(oauth_token),
      600,
      JSON.stringify({ oauth_token_secret, workspaceId, userId, return_to }),
    )
    return url
  }

  async handleCallback({ oauth_token, oauth_verifier }) {
    const { getRedis } = await import('../lib/redis.js')
    const session = await loadTwitterOAuthSession(oauth_token)
    const oauth_token_secret = session?.oauth_token_secret
    if (!oauth_token_secret) throw new Error('OAuth session expired. Please try again.')
    await getRedis().del(TWITTER_OAUTH_KEY(oauth_token))

    const client = new TwitterApi({
      appKey: this.appKey,
      appSecret: this.appSecret,
      accessToken: oauth_token,
      accessSecret: oauth_token_secret,
    })
    const { client: loggedClient, accessToken, accessSecret } = await client.login(oauth_verifier)
    const me = await loggedClient.v2.me({ 'user.fields': ['profile_image_url', 'public_metrics'] })

    return {
      provider: 'twitter',
      provider_id: me.data.id,
      name: me.data.name,
      username: me.data.username,
      media: { avatar: me.data.profile_image_url },
      data: { public_metrics: me.data.public_metrics },
      access_token: { token: accessToken, secret: accessSecret },
      authorized: true,
    }
  }

  _getClient() {
    if (!this.account?.access_token) throw new Error('Account not authorized')
    const { token, secret } = this.account.access_token
    return new TwitterApi({ appKey: this.appKey, appSecret: this.appSecret, accessToken: token, accessSecret: secret })
  }

  async getAccount() {
    const client = this._getClient()
    const me = await client.v2.me({ 'user.fields': ['profile_image_url', 'public_metrics'] })
    return {
      name: me.data.name,
      username: me.data.username,
      media: { avatar: me.data.profile_image_url },
      data: { public_metrics: me.data.public_metrics },
    }
  }

  async publishPost() {
    throw new Error(
      'Twitter publishing runs in the worker (tasks.social.publish_post → connectors.twitter). API routes must use dispatchPublishPost only.',
    )
  }

  async getExternalPostUrl(providerPostId) {
    return `https://twitter.com/i/web/status/${providerPostId}`
  }

  hasEntities() { return false }

  getCharLimit() { return CHAR_LIMITS[this.tier] || 280 }
  getMediaLimit() { return { photos: 4, videos: 1, gifs: 1, mixed: false } }
}
