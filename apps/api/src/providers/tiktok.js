/**
 * TikTok Content API — PKCE OAuth + publish pipeline.
 *
 * OAuth (API): getAuthUrl, handleCallback (token + user info during connect).
 * Execution: getAccount. **Publishing** — worker only (`tasks.social.publish_post`; TikTok Content API not wired in worker yet).
 */
import axios from 'axios'
import crypto from 'crypto'

const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/'
const AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/'
const USERINFO_URL = 'https://open.tiktokapis.com/v2/user/info/'

export class TikTokProvider {
  constructor(config = {}, account = null) {
    this.config = config
    this.account = account
    this.clientKey = config.client_key || process.env.TIKTOK_CLIENT_KEY
    this.clientSecret = config.client_secret || process.env.TIKTOK_CLIENT_SECRET
    this.callbackUrl = process.env.TIKTOK_CALLBACK_URL || `${process.env.API_URL || 'http://localhost:4010'}/callback/tiktok`
  }

  async getAuthUrl() {
    // PKCE flow
    const codeVerifier = crypto.randomBytes(64).toString('base64url')
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
    const state = crypto.randomBytes(16).toString('hex')

    // Store verifier in Redis keyed by state
    const { getRedis } = await import('../lib/redis.js')
    await getRedis().setex(`tiktok:pkce:${state}`, 600, codeVerifier)

    const params = new URLSearchParams({
      client_key: this.clientKey,
      redirect_uri: this.callbackUrl,
      response_type: 'code',
      scope: 'user.info.basic,video.upload,video.publish',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })
    return `${AUTH_URL}?${params}`
  }

  async handleCallback({ code, state }) {
    const { getRedis } = await import('../lib/redis.js')
    let codeVerifier = null
    if (state) {
      codeVerifier = await getRedis().get(`tiktok:pkce:${state}`)
      if (codeVerifier) await getRedis().del(`tiktok:pkce:${state}`)
    }

    const params = {
      client_key: this.clientKey,
      client_secret: this.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.callbackUrl,
    }
    if (codeVerifier) params.code_verifier = codeVerifier

    const tokenRes = await axios.post(TOKEN_URL, new URLSearchParams(params), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    const { access_token, refresh_token, open_id } = tokenRes.data

    const meRes = await axios.get(USERINFO_URL, {
      params: { fields: 'open_id,display_name,avatar_url' },
      headers: { Authorization: `Bearer ${access_token}` },
    })
    const user = meRes.data?.data?.user || {}

    return {
      provider: 'tiktok',
      provider_id: open_id || user.open_id,
      name: user.display_name || open_id,
      username: user.display_name || open_id,
      media: { avatar: user.avatar_url },
      data: {},
      access_token: { token: access_token, refresh_token },
      authorized: true,
    }
  }

  async getAccount() {
    const token = this.account?.access_token?.token
    const res = await axios.get(USERINFO_URL, {
      params: { fields: 'open_id,display_name,avatar_url,follower_count' },
      headers: { Authorization: `Bearer ${token}` },
    })
    const user = res.data?.data?.user || {}
    return {
      name: user.display_name,
      username: user.display_name,
      media: { avatar: user.avatar_url },
      data: { follower_count: user.follower_count },
    }
  }

  async publishPost() {
    throw new Error(
      'TikTok publishing runs in the worker (tasks.social.publish_post). Implement connectors.tiktok + publish_native — do not call publishPost from apps/api.',
    )
  }

  hasEntities() { return false }
  getCharLimit() { return 150 }
  getMediaLimit() { return { photos: 0, videos: 1, gifs: 0, mixed: false } }
}
