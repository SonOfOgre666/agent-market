import { TwitterApi } from 'twitter-api-v2'
import * as Account from '../models/Account.js'

// Character limits per tier
const CHAR_LIMITS = { legacy: 140, free: 280, basic: 280, pay_as_you_go: 280 }

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
  async getAuthUrl() {
    const client = new TwitterApi({ appKey: this.appKey, appSecret: this.appSecret })
    const { url, oauth_token, oauth_token_secret } = await client.generateAuthLink(this.callbackUrl)
    // Store oauth_token_secret temporarily in Redis
    const { getRedis } = await import('../db/redis.js')
    await getRedis().setex(`twitter:oauth:${oauth_token}`, 600, oauth_token_secret)
    return url
  }

  async handleCallback({ oauth_token, oauth_verifier }) {
    const { getRedis } = await import('../db/redis.js')
    const oauth_token_secret = await getRedis().get(`twitter:oauth:${oauth_token}`)
    if (!oauth_token_secret) throw new Error('OAuth session expired. Please try again.')

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

  async publishPost(version) {
    const client = this._getClient()
    const content = version.content || []
    const textBlock = content.find(b => b.type === 'text')
    const mediaBlocks = content.filter(b => b.type === 'media')
    const text = textBlock?.body || ''

    // Upload media
    const mediaIds = []
    for (const block of mediaBlocks) {
      for (const item of block.media || []) {
        const mediaId = await this._uploadMedia(client, item)
        if (mediaId) mediaIds.push(mediaId)
      }
    }

    const tweetPayload = { text }
    if (mediaIds.length) tweetPayload.media = { media_ids: mediaIds }

    const tweet = await client.v2.tweet(tweetPayload)
    return { provider_post_id: tweet.data.id, url: `https://twitter.com/i/web/status/${tweet.data.id}` }
  }

  async _uploadMedia(client, mediaItem) {
    try {
      const { default: axios } = await import('axios')
      const response = await axios.get(mediaItem.url, { responseType: 'arraybuffer' })
      const buffer = Buffer.from(response.data)
      const mimeType = mediaItem.mime_type || 'image/jpeg'
      const mediaId = await client.v1.uploadMedia(buffer, { mimeType })
      return mediaId
    } catch (err) {
      console.error('[Twitter] Media upload failed:', err.message)
      return null
    }
  }

  async getExternalPostUrl(providerPostId) {
    return `https://twitter.com/i/web/status/${providerPostId}`
  }

  hasEntities() { return false }

  getCharLimit() { return CHAR_LIMITS[this.tier] || 280 }
  getMediaLimit() { return { photos: 4, videos: 1, gifs: 1, mixed: false } }
}
