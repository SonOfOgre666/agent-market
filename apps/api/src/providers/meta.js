/**
 * Meta Graph — Facebook Page + Instagram Business (single app, callbackType-driven).
 *
 * OAuth (API): getAuthUrl, handleCallback (authorization server + token exchange + minimal /me for connect).
 * Execution: getEntities, saveEntity, getAccount. **Publishing and comment Graph I/O** — worker only
 * (``tasks.social.publish_post`` + future comment tasks); do not call ``publishPost`` / ``getComments`` / ``postComment`` from apps/api.
 */
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
  // Ads permissions — allows creating/managing campaigns via the Marketing API
  'ads_management',
  'ads_read',
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
      // user_token is stored here so saveEntity() can persist it for ads use
      data: { user_token: longToken },
      access_token: { token: longToken },
      authorized: true,
    }
  }

  hasEntities() { return true }

  async getEntities() {
    // At entity-selection time, this.account holds the temp accountData from Redis
    const token = this.account?.access_token?.token || this.account?.data?.user_token
    if (!token) throw new Error('Account not authorized')

    // Get Facebook pages
    const pagesRes = await axios.get(`${this.base}/me/accounts`, {
      params: { access_token: token, fields: 'id,name,picture,access_token,instagram_business_account' },
    })
    const pages = pagesRes.data.data || []

    const allEntities = []
    for (const page of pages) {
      allEntities.push({ type: 'facebook_page', id: page.id, name: page.name, media: { avatar: page.picture?.data?.url }, access_token: page.access_token, user_token: token })
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
            user_token: token,
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
      // user_token enables this account to also manage ads via the Marketing API
      data: { page_id: entity.page_id, user_token: entity.user_token },
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
      params: { access_token: token, fields: 'id,name,picture.type(large){url},followers_count' },
    })
    const pic = res.data.picture
    const avatar = pic?.url || pic?.data?.url || null
    return { name: res.data.name, username: res.data.id, media: { avatar } }
  }

  async publishPost() {
    throw new Error(
      'Facebook / Instagram publishing runs in the worker (tasks.social.publish_post → publish_native). Do not call publishPost from apps/api.',
    )
  }

  async getComments() {
    throw new Error(
      'Comment reads run in the worker when implemented (Graph via connectors). No apps/api route calls this today.',
    )
  }

  async postComment() {
    throw new Error(
      'Comment writes run in the worker when implemented (Graph via connectors). No apps/api route calls this today.',
    )
  }

  getCharLimit() { return 5000 }
  getMediaLimit() { return { photos: 10, videos: 1, gifs: 1, mixed: true } }
}
