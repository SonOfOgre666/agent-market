/**
 * Instagram API with Instagram Login (launched July 2024)
 * Authenticates via Instagram credentials — no Facebook account or Page required.
 * Uses graph.instagram.com (not graph.facebook.com).
 *
 * Scopes: instagram_business_basic, instagram_business_content_publish,
 *         instagram_business_manage_comments, instagram_business_manage_insights
 *
 * Layer (Rules/CLEAN_ARCHITECTURE_ROADMAP.md P1):
 * - OAuth (API): getAuthUrl, handleCallback (token exchange + profile read for connect).
 * - Execution: getAccount (+ token refresh). **Publishing and comments** — worker only (`tasks.social.publish_post` for publish).
 */
import axios from 'axios'

const AUTH_URL = 'https://api.instagram.com/oauth/authorize'
const TOKEN_URL = 'https://api.instagram.com/oauth/access_token'
const LONG_LIVED_URL = 'https://graph.instagram.com/access_token'
const REFRESH_URL = 'https://graph.instagram.com/refresh_access_token'
const API_BASE = 'https://graph.instagram.com/v21.0'

const SCOPES = [
  'instagram_business_basic',            // read profile & media
  'instagram_business_content_publish',  // publish images / videos / reels / stories
  'instagram_business_manage_comments',  // post & read comments
  'instagram_business_manage_insights',  // account & media insights (reach, views)
].join(',')

export class InstagramLoginProvider {
  constructor(config = {}, account = null) {
    this.config = config
    this.account = account
    this.appId = config.app_id || process.env.INSTAGRAM_APP_ID
    this.appSecret = config.app_secret || process.env.INSTAGRAM_APP_SECRET
    this.callbackUrl = process.env.INSTAGRAM_LOGIN_CALLBACK_URL
      || `${process.env.API_URL || 'http://localhost:4010'}/callback/instagram_login`
  }

  // ─── OAuth ───────────────────────────────────────────────────────────────────

  async getAuthUrl() {
    const { nanoid } = await import('nanoid')
    const { getRedis } = await import('../lib/redis.js')
    const state = nanoid()
    await getRedis().setex(`oauth_state:${state}`, 600, 'instagram_login')

    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.callbackUrl,
      scope: SCOPES,
      response_type: 'code',
      state,
    })
    return `${AUTH_URL}?${params}`
  }

  async handleCallback({ code }) {
    // Strip the non-standard `#_` suffix Instagram appends to the auth code
    const cleanCode = (code || '').replace(/#_$/, '')

    // Step 1 — short-lived token
    const tokenRes = await axios.post(TOKEN_URL, new URLSearchParams({
      client_id: this.appId,
      client_secret: this.appSecret,
      grant_type: 'authorization_code',
      redirect_uri: this.callbackUrl,
      code: cleanCode,
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })

    const { access_token: shortToken, user_id } = tokenRes.data

    // Step 2 — long-lived token (valid 60 days)
    const longRes = await axios.get(LONG_LIVED_URL, {
      params: {
        grant_type: 'ig_exchange_token',
        client_secret: this.appSecret,
        access_token: shortToken,
      },
    })
    const { access_token: longToken } = longRes.data

    // Step 3 — profile info
    const meRes = await axios.get(`${API_BASE}/me`, {
      params: { fields: 'id,name,username,profile_picture_url,followers_count', access_token: longToken },
    })
    const me = meRes.data

    return {
      provider: 'instagram_login',
      provider_id: me.id || String(user_id),
      name: me.name || me.username,
      username: me.username,
      media: { avatar: me.profile_picture_url },
      data: { followers_count: me.followers_count },
      access_token: { token: longToken },
      authorized: true,
    }
  }

  // ─── Account refresh ─────────────────────────────────────────────────────────

  async getAccount() {
    const token = await this._freshToken()
    const res = await axios.get(`${API_BASE}/me`, {
      params: { fields: 'id,name,username,profile_picture_url,followers_count', access_token: token },
    })
    const me = res.data
    return {
      name: me.name || me.username,
      username: me.username,
      media: { avatar: me.profile_picture_url },
      data: { followers_count: me.followers_count },
    }
  }

  // ─── Publishing (worker) ───────────────────────────────────────────────────

  async publishPost() {
    throw new Error(
      'Instagram Login publishing runs in the worker (tasks.social.publish_post → publish_native). Do not call publishPost from apps/api.',
    )
  }

  // ─── Comments (worker — not wired from routes yet) ───────────────────────────

  async getComments() {
    throw new Error(
      'Instagram Login comment reads belong in the worker when exposed via API. No apps/api route calls this today.',
    )
  }

  async postComment() {
    throw new Error(
      'Instagram Login comment writes belong in the worker when exposed via API. No apps/api route calls this today.',
    )
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  // Silently refresh the token if it's approaching expiry (tokens live 60 days;
  // the API allows refresh after 24 hours). Falls back to stored token on error.
  async _freshToken() {
    const token = this.account?.access_token?.token
    if (!token) throw new Error('Account not authorized')
    try {
      const res = await axios.get(REFRESH_URL, {
        params: { grant_type: 'ig_refresh_token', access_token: token },
      })
      const refreshed = res.data?.access_token
      if (refreshed && refreshed !== token && this.account?._id) {
        const { updateAccount } = await import('../models/Account.js')
        await updateAccount(this.account._id.toString(), { 'access_token.token': refreshed })
        this.account.access_token.token = refreshed
      }
    } catch {
      // Non-fatal — use the stored token as-is
    }
    return this.account.access_token.token
  }

  hasEntities() { return false }
  getCharLimit() { return 2200 }
  getMediaLimit() { return { photos: 10, videos: 1, gifs: 0, mixed: false } }
}
