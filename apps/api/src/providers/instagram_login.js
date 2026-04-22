/**
 * Instagram API with Instagram Login (launched July 2024)
 * Authenticates via Instagram credentials — no Facebook account or Page required.
 * Uses graph.instagram.com (not graph.facebook.com).
 *
 * Scopes: instagram_business_basic, instagram_business_content_publish,
 *         instagram_business_manage_comments
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
    const { getRedis } = await import('../db/redis.js')
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

  // ─── Publishing ──────────────────────────────────────────────────────────────

  _validateMedia(allMedia) {
    const MAX_SIZE = 8 * 1024 * 1024
    const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg']
    const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime']
    const MIN_RATIO = 0.8
    const MAX_RATIO = 1.91
    for (const m of allMedia) {
      const isVideo = m.mime_type?.startsWith('video')
      if (isVideo) {
        if (!ALLOWED_VIDEO_TYPES.includes(m.mime_type)) {
          throw new Error(`Instagram does not support video format "${m.mime_type}". Use MP4 or MOV.`)
        }
      } else {
        if (!ALLOWED_IMAGE_TYPES.includes(m.mime_type)) {
          throw new Error(`Instagram does not support image format "${m.mime_type}". Convert to JPEG before uploading.`)
        }
        if (m.size && m.size > MAX_SIZE) {
          throw new Error(`Image "${m.name}" is ${(m.size / 1024 / 1024).toFixed(1)} MB — Instagram's limit is 8 MB.`)
        }
        if (m.width && m.height) {
          const ratio = m.width / m.height
          if (ratio < MIN_RATIO || ratio > MAX_RATIO) {
            throw new Error(`Image "${m.name}" has aspect ratio ${ratio.toFixed(2)}:1 — Instagram requires between 4:5 (0.8) and 1.91:1.`)
          }
        }
      }
    }
  }

  async publishPost(version) {
    const token = await this._freshToken()
    const igId = this.account.provider_id
    const content = version.content || []
    const textBlock = content.find(b => b.type === 'text')
    const mediaBlocks = content.filter(b => b.type === 'media')
    const caption = textBlock?.body || ''
    const isStory = version.is_story === true
    const allMedia = mediaBlocks.flatMap(b => b.media || [])

    if (allMedia.length === 0) throw new Error('Instagram requires at least one media item')
    this._validateMedia(allMedia)

    // Story
    if (isStory) {
      const item = allMedia[0]
      const isVideo = item.mime_type?.startsWith('video')
      const containerRes = await axios.post(`${API_BASE}/${igId}/media`, {
        [isVideo ? 'video_url' : 'image_url']: item.url,
        media_type: 'STORIES',
        access_token: token,
      })
      await this._waitForContainer(containerRes.data.id, token)
      const publishRes = await axios.post(`${API_BASE}/${igId}/media_publish`, {
        creation_id: containerRes.data.id,
        access_token: token,
      })
      return { provider_post_id: publishRes.data.id }
    }

    // Single image or reel
    if (allMedia.length === 1) {
      const isVideo = allMedia[0].mime_type?.startsWith('video')
      const containerRes = await axios.post(`${API_BASE}/${igId}/media`, {
        [isVideo ? 'video_url' : 'image_url']: allMedia[0].url,
        caption,
        media_type: isVideo ? 'REELS' : 'IMAGE',
        access_token: token,
      })
      await this._waitForContainer(containerRes.data.id, token)
      const publishRes = await axios.post(`${API_BASE}/${igId}/media_publish`, {
        creation_id: containerRes.data.id,
        access_token: token,
      })
      return { provider_post_id: publishRes.data.id }
    }

    // Carousel (multiple images/videos)
    const itemIds = await Promise.all(allMedia.map(async m => {
      const isVideo = m.mime_type?.startsWith('video')
      const r = await axios.post(`${API_BASE}/${igId}/media`, {
        [isVideo ? 'video_url' : 'image_url']: m.url,
        is_carousel_item: true,
        media_type: isVideo ? 'VIDEO' : 'IMAGE',
        access_token: token,
      })
      await this._waitForContainer(r.data.id, token)
      return r.data.id
    }))

    const carouselRes = await axios.post(`${API_BASE}/${igId}/media`, {
      media_type: 'CAROUSEL',
      caption,
      children: itemIds,
      access_token: token,
    })
    const publishRes = await axios.post(`${API_BASE}/${igId}/media_publish`, {
      creation_id: carouselRes.data.id,
      access_token: token,
    })
    return { provider_post_id: publishRes.data.id }
  }

  // ─── Comments ─────────────────────────────────────────────────────────────────

  async postComment(providerPostId, text) {
    const token = await this._freshToken()
    await axios.post(`${API_BASE}/${providerPostId}/comments`, { text, access_token: token })
  }

  async getComments(providerPostId) {
    const token = await this._freshToken()
    const res = await axios.get(`${API_BASE}/${providerPostId}/comments`, {
      params: { fields: 'id,text,username,timestamp', access_token: token },
    })
    return (res.data?.data || []).map(c => ({
      id: c.id,
      text: c.text,
      author: c.username,
      created_at: c.timestamp,
    }))
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

  async _waitForContainer(containerId, token, retries = 10) {
    for (let i = 0; i < retries; i++) {
      const res = await axios.get(`${API_BASE}/${containerId}`, {
        params: { fields: 'status_code', access_token: token },
      })
      if (res.data.status_code === 'FINISHED') return
      await new Promise(r => setTimeout(r, 3000))
    }
    throw new Error('Instagram media container timed out')
  }

  hasEntities() { return false }
  getCharLimit() { return 2200 }
  getMediaLimit() { return { photos: 10, videos: 1, gifs: 0, mixed: false } }
}
