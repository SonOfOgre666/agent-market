import axios from 'axios'

const GRAPH_API = 'https://graph.facebook.com'

const SCOPES = [
  // Facebook Page permissions
  'business_management',       // access business admin pages
  'pages_show_list',           // list pages the user manages
  'read_insights',             // read Page-level insights data
  'pages_manage_posts',        // create/publish posts (text, photos, videos)
  'pages_read_engagement',     // required by pages_manage_posts; read page posts/photos/videos
  'pages_manage_engagement',   // publish first comment on page posts
  'pages_read_user_content',   // required by pages_manage_engagement
  // Instagram permissions
  'instagram_basic',           // read Instagram Business account profile info
  'instagram_content_publish', // publish photo/video posts on Instagram
  'instagram_manage_comments', // publish first comment on Instagram posts
  'instagram_manage_insights', // read Instagram Business account insights / follower count
].join(',')

export class MetaProvider {
  constructor(config = {}, account = null) {
    this.config = config
    this.account = account
    this.appId = config.app_id
    this.appSecret = config.app_secret
    this.apiVersion = config.api_version || 'v25.0'
    this.base = `${GRAPH_API}/${this.apiVersion}`
    const base = process.env.API_URL || 'http://localhost:4010'
    // callbackType is set by the provider subclass — facebook_page or instagram
    const callbackType = config.callbackType || 'facebook_page'
    const callbackPath = callbackType === 'instagram' ? '/callback/instagram' : '/callback/facebook_page'
    const fallbackInstagramCallback = callbackType === 'instagram' ? process.env.INSTAGRAM_CALLBACK_URL : undefined
    this.callbackUrl = process.env[`META_CALLBACK_URL_${callbackType.toUpperCase()}`]
      || fallbackInstagramCallback
      || `${base}${callbackPath}`
    // Which entity types to expose for this provider
    this.entityType = callbackType === 'instagram' ? 'instagram' : 'facebook_page'
  }

  async getAuthUrl() {
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.callbackUrl,
      scope: SCOPES,
      response_type: 'code',
    })
    return `https://www.facebook.com/dialog/oauth?${params}`
  }

  async handleCallback({ code }) {
    // Exchange code for token
    let tokenRes
    try {
      tokenRes = await axios.post(`${this.base}/oauth/access_token`, null, {
        params: { client_id: this.appId, client_secret: this.appSecret, redirect_uri: this.callbackUrl, code },
      })
    } catch (err) {
      const fbError = err.response?.data?.error
      throw new Error(fbError ? `Facebook: ${fbError.message} (code ${fbError.code})` : err.message)
    }
    const { access_token } = tokenRes.data

    // Get long-lived token
    const longTokenRes = await axios.get(`${this.base}/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: this.appId,
        client_secret: this.appSecret,
        fb_exchange_token: access_token,
      },
    })
    const longToken = longTokenRes.data.access_token

    // Get user info
    const meRes = await axios.get(`${this.base}/me`, {
      params: { access_token: longToken, fields: 'id,name,picture' },
    })
    const me = meRes.data

    return {
      provider: 'facebook',
      provider_id: me.id,
      name: me.name,
      username: me.id,
      media: { avatar: me.picture?.data?.url },
      data: {},
      access_token: { token: longToken },
      authorized: true,
    }
  }

  hasEntities() { return true }

  async getEntities() {
    const token = this.account?.access_token?.token
    if (!token) throw new Error('Account not authorized')

    // Get Facebook pages
    const pagesRes = await axios.get(`${this.base}/me/accounts`, {
      params: { access_token: token, fields: 'id,name,picture,access_token,instagram_business_account' },
    })
    const pages = pagesRes.data.data || []

    const allEntities = []
    for (const page of pages) {
      allEntities.push({ type: 'facebook_page', id: page.id, name: page.name, media: { avatar: page.picture?.data?.url }, access_token: page.access_token })
      if (page.instagram_business_account) {
        const igRes = await axios.get(`${this.base}/${page.instagram_business_account.id}`, {
          params: { access_token: token, fields: 'id,name,profile_picture_url,username' },
        }).catch(() => null)
        if (igRes?.data) {
          allEntities.push({
            type: 'instagram',
            id: igRes.data.id,
            name: igRes.data.name,
            username: igRes.data.username,
            media: { avatar: igRes.data.profile_picture_url },
            page_id: page.id,
            page_access_token: page.access_token,
          })
        }
      }
    }
    // Filter to only the entity type relevant to this provider (facebook_page or instagram)
    return allEntities.filter(e => e.type === this.entityType)
  }

  async saveEntity(entity, user_id, workspace_id) {
    const { upsertAccount } = await import('../models/Account.js')
    return upsertAccount({
      workspace_id: workspace_id || null,
      provider: entity.type === 'instagram' ? 'instagram' : 'facebook',
      provider_id: entity.id,
      name: entity.name,
      username: entity.username || entity.id,
      media: entity.media || {},
      data: { page_id: entity.page_id },
      access_token: { token: entity.access_token || entity.page_access_token },
      authorized: true,
    })
  }

  async getAccount() {
    const token = this.account?.access_token?.token
    const isInstagram = this.account?.provider === 'instagram'
    if (isInstagram) {
      const res = await axios.get(`${this.base}/${this.account.provider_id}`, {
        params: { access_token: token, fields: 'id,name,username,profile_picture_url,followers_count' },
      })
      return { name: res.data.name, username: res.data.username, media: { avatar: res.data.profile_picture_url } }
    }
    const res = await axios.get(`${this.base}/${this.account.provider_id}`, {
      params: { access_token: token, fields: 'id,name,picture,fan_count' },
    })
    return { name: res.data.name, username: res.data.id, media: { avatar: res.data.picture?.data?.url } }
  }

  async publishPost(version) {
    const token = this.account?.access_token?.token
    const content = version.content || []
    const textBlock = content.find(b => b.type === 'text')
    const linkBlock = content.find(b => b.type === 'link')
    const mediaBlocks = content.filter(b => b.type === 'media')
    const message = textBlock?.body || ''
    const linkUrl = linkBlock?.url || null
    const targeting = version.targeting || null
    const isInstagram = this.account?.provider === 'instagram'
    const isStory = version.is_story === true

    if (isInstagram) {
      return this._publishInstagram(token, message, mediaBlocks, isStory)
    }
    return this._publishFacebook(token, message, mediaBlocks, linkUrl, targeting)
  }

  async _publishFacebook(token, message, mediaBlocks, linkUrl, targeting) {
    const pageId = this.account.provider_id
    const allMedia = mediaBlocks.flatMap(b => b.media || [])

    // Build targeting object for Facebook API
    const targetingParam = this._buildTargeting(targeting)

    // Text-only or link post
    if (allMedia.length === 0) {
      const payload = { message, access_token: token }
      if (linkUrl) payload.link = linkUrl
      if (targetingParam) payload.targeting = JSON.stringify(targetingParam)
      const res = await axios.post(`${this.base}/${pageId}/feed`, payload)
      return { provider_post_id: res.data.id }
    }

    // Single video or GIF — Facebook animates GIFs only via the /videos endpoint
    if (allMedia.length === 1 && (allMedia[0].mime_type?.startsWith('video') || allMedia[0].mime_type === 'image/gif')) {
      const payload = { description: message, file_url: allMedia[0].url, access_token: token }
      if (targetingParam) payload.targeting = JSON.stringify(targetingParam)
      const res = await axios.post(`${this.base}/${pageId}/videos`, payload)
      return { provider_post_id: res.data.id }
    }

    // Single photo
    if (allMedia.length === 1) {
      const payload = { message, url: allMedia[0].url, access_token: token }
      if (linkUrl) payload.link = linkUrl
      if (targetingParam) payload.targeting = JSON.stringify(targetingParam)
      const res = await axios.post(`${this.base}/${pageId}/photos`, payload)
      return { provider_post_id: res.data.id }
    }

    // Multi-photo: upload each unpublished then attach to a feed post
    const photoIds = await Promise.all(allMedia.map(async m => {
      const r = await axios.post(`${this.base}/${pageId}/photos`, { url: m.url, published: false, access_token: token })
      return { media_fbid: r.data.id }
    }))
    const payload = { message, attached_media: photoIds, access_token: token }
    if (linkUrl) payload.link = linkUrl
    if (targetingParam) payload.targeting = JSON.stringify(targetingParam)
    const res = await axios.post(`${this.base}/${pageId}/feed`, payload)
    return { provider_post_id: res.data.id }
  }

  _buildTargeting(targeting) {
    if (!targeting) return null
    const result = {}
    if (targeting.countries?.length) {
      result.geo_locations = { countries: targeting.countries }
    }
    if (targeting.age_min) result.age_min = targeting.age_min
    if (targeting.age_max) result.age_max = targeting.age_max
    return Object.keys(result).length ? result : null
  }

  _validateInstagramMedia(allMedia) {
    const MAX_SIZE = 8 * 1024 * 1024 // 8 MB
    const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg']
    const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime']
    const MIN_RATIO = 0.8   // 4:5 portrait
    const MAX_RATIO = 1.91  // 1.91:1 landscape

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

  async _publishInstagram(token, message, mediaBlocks, isStory = false) {
    const igId = this.account.provider_id
    const allMedia = mediaBlocks.flatMap(b => b.media || [])

    if (allMedia.length === 0) throw new Error('Instagram requires at least one media item')

    this._validateInstagramMedia(allMedia)

    // Stories: single image or video only
    if (isStory) {
      const item = allMedia[0]
      const isVideo = item.mime_type?.startsWith('video')
      const containerRes = await axios.post(`${this.base}/${igId}/media`, {
        [isVideo ? 'video_url' : 'image_url']: item.url,
        media_type: 'STORIES',
        access_token: token,
      })
      await this._waitForContainer(containerRes.data.id, token)
      const publishRes = await axios.post(`${this.base}/${igId}/media_publish`, { creation_id: containerRes.data.id, access_token: token })
      return { provider_post_id: publishRes.data.id }
    }

    if (allMedia.length === 1) {
      const isVideo = allMedia[0].mime_type?.startsWith('video')
      const containerRes = await axios.post(`${this.base}/${igId}/media`, {
        [isVideo ? 'video_url' : 'image_url']: allMedia[0].url,
        caption: message,
        media_type: isVideo ? 'REELS' : 'IMAGE',
        access_token: token,
      })
      await this._waitForContainer(containerRes.data.id, token)
      const publishRes = await axios.post(`${this.base}/${igId}/media_publish`, { creation_id: containerRes.data.id, access_token: token })
      return { provider_post_id: publishRes.data.id }
    }

    // Carousel
    const itemIds = await Promise.all(allMedia.map(async m => {
      const isVideo = m.mime_type?.startsWith('video')
      const r = await axios.post(`${this.base}/${igId}/media`, {
        [isVideo ? 'video_url' : 'image_url']: m.url,
        is_carousel_item: true,
        media_type: isVideo ? 'VIDEO' : 'IMAGE',
        access_token: token,
      })
      await this._waitForContainer(r.data.id, token)
      return r.data.id
    }))

    const carouselRes = await axios.post(`${this.base}/${igId}/media`, {
      media_type: 'CAROUSEL',
      caption: message,
      children: itemIds,
      access_token: token,
    })
    const publishRes = await axios.post(`${this.base}/${igId}/media_publish`, { creation_id: carouselRes.data.id, access_token: token })
    return { provider_post_id: publishRes.data.id }
  }

  // Fetch comments from a published post/media
  async getComments(providerPostId) {
    const token = this.account?.access_token?.token
    const isInstagram = this.account?.provider === 'instagram'

    if (isInstagram) {
      const res = await axios.get(`${this.base}/${providerPostId}/comments`, {
        params: { fields: 'id,text,username,timestamp', access_token: token },
      })
      return (res.data?.data || []).map(c => ({ id: c.id, text: c.text, author: c.username, created_at: c.timestamp }))
    }

    // Facebook page post comments
    const res = await axios.get(`${this.base}/${providerPostId}/comments`, {
      params: { fields: 'id,message,from,created_time', access_token: token },
    })
    return (res.data?.data || []).map(c => ({ id: c.id, text: c.message, author: c.from?.name, created_at: c.created_time }))
  }

  async _waitForContainer(containerId, token, retries = 10) {
    for (let i = 0; i < retries; i++) {
      const res = await axios.get(`${this.base}/${containerId}`, { params: { fields: 'status_code', access_token: token } })
      if (res.data.status_code === 'FINISHED') return
      await new Promise(r => setTimeout(r, 3000))
    }
    throw new Error('Instagram media container timed out')
  }

  async postComment(providerPostId, text) {
    const token = this.account?.access_token?.token
    const isInstagram = this.account?.provider === 'instagram'
    if (isInstagram) {
      // POST /{ig-media-id}/comments
      await axios.post(`${this.base}/${providerPostId}/comments`, { text, access_token: token })
    } else {
      // POST /{post-id}/comments with page access token
      await axios.post(`${this.base}/${providerPostId}/comments`, { message: text, access_token: token })
    }
  }

  getCharLimit() { return 5000 }
  getMediaLimit() { return { photos: 10, videos: 1, gifs: 1, mixed: true } }
}
