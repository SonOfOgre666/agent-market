import axios from 'axios'

const AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization'
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken'
const API_BASE = 'https://api.linkedin.com/v2'

const SCOPES = [
  'r_liteprofile',
  'r_emailaddress',
  'w_member_social',
].join(' ')

export class LinkedInProvider {
  constructor(config = {}, account = null) {
    this.config = config
    this.account = account
    this.clientId = config.client_id || process.env.LINKEDIN_CLIENT_ID
    this.clientSecret = config.client_secret || process.env.LINKEDIN_CLIENT_SECRET
    this.callbackUrl = process.env.LINKEDIN_CALLBACK_URL || `${process.env.API_URL || 'http://localhost:4010'}/callback/linkedin`
  }

  async getAuthUrl() {
    const { getRedis } = await import('../db/redis.js')
    const { nanoid } = await import('nanoid')
    const state = nanoid()
    await getRedis().setex(`linkedin:state:${state}`, 600, '1')

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.callbackUrl,
      state,
      scope: SCOPES,
    })
    return `${AUTH_URL}?${params}`
  }

  async handleCallback({ code }) {
    const tokenRes = await axios.post(TOKEN_URL, new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.callbackUrl,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })

    const { access_token } = tokenRes.data

    const [profileRes, emailRes] = await Promise.all([
      axios.get(`${API_BASE}/me`, {
        params: { projection: '(id,localizedFirstName,localizedLastName,profilePicture(displayImage~:playableStreams))' },
        headers: { Authorization: `Bearer ${access_token}` },
      }),
      axios.get(`${API_BASE}/emailAddress`, {
        params: { q: 'members', projection: '(elements*(handle~))' },
        headers: { Authorization: `Bearer ${access_token}` },
      }).catch(() => null),
    ])

    const profile = profileRes.data
    const name = `${profile.localizedFirstName} ${profile.localizedLastName}`.trim()
    const avatarElements = profile.profilePicture?.['displayImage~']?.elements || []
    const avatar = avatarElements[avatarElements.length - 1]?.identifiers?.[0]?.identifier || null

    return {
      provider: 'linkedin',
      provider_id: profile.id,
      name,
      username: name,
      media: { avatar },
      data: {},
      access_token: { token: access_token },
      authorized: true,
    }
  }

  async getAccount() {
    const token = this.account?.access_token?.token
    const res = await axios.get(`${API_BASE}/me`, {
      params: { projection: '(id,localizedFirstName,localizedLastName,profilePicture(displayImage~:playableStreams))' },
      headers: { Authorization: `Bearer ${token}` },
    })
    const profile = res.data
    const name = `${profile.localizedFirstName} ${profile.localizedLastName}`.trim()
    const avatarElements = profile.profilePicture?.['displayImage~']?.elements || []
    const avatar = avatarElements[avatarElements.length - 1]?.identifiers?.[0]?.identifier || null
    return { name, username: name, media: { avatar }, data: {} }
  }

  async publishPost(version) {
    const token = this.account?.access_token?.token
    const authorUrn = `urn:li:person:${this.account.provider_id}`
    const content = version.content || []
    const textBlock = content.find(b => b.type === 'text')
    const linkBlock = content.find(b => b.type === 'link')
    const mediaBlocks = content.filter(b => b.type === 'media')
    const text = textBlock?.body || ''
    const allMedia = mediaBlocks.flatMap(b => b.media || [])

    if (allMedia.length > 0) {
      return this._publishWithMedia(token, authorUrn, text, allMedia, linkBlock?.url)
    }
    return this._publishText(token, authorUrn, text, linkBlock?.url)
  }

  async _publishText(token, authorUrn, text, linkUrl) {
    const specificContent = linkUrl
      ? {
          com_linkedin_ugc_ShareContent: {
            shareCommentary: { text },
            shareMediaCategory: 'ARTICLE',
            media: [{ status: 'READY', originalUrl: linkUrl }],
          },
        }
      : {
          com_linkedin_ugc_ShareContent: {
            shareCommentary: { text },
            shareMediaCategory: 'NONE',
          },
        }

    const body = {
      author: authorUrn,
      lifecycleState: 'PUBLISHED',
      specificContent,
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    }

    const res = await axios.post(`${API_BASE}/ugcPosts`, body, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' },
    })
    return { provider_post_id: res.headers['x-restli-id'] || res.data?.id }
  }

  async _publishWithMedia(token, authorUrn, text, mediaItems, linkUrl) {
    // Upload each asset and collect URNs
    const assetUrns = await Promise.all(
      mediaItems.map(item => this._uploadAsset(token, authorUrn, item))
    )

    const isVideo = mediaItems[0]?.mime_type?.startsWith('video')
    const shareMediaCategory = isVideo ? 'VIDEO' : 'IMAGE'

    const media = assetUrns.map((urn, i) => ({
      status: 'READY',
      media: urn,
      title: { text: mediaItems[i]?.name || '' },
    }))

    const body = {
      author: authorUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text },
          shareMediaCategory,
          media,
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    }

    const res = await axios.post(`${API_BASE}/ugcPosts`, body, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' },
    })
    return { provider_post_id: res.headers['x-restli-id'] || res.data?.id }
  }

  async _uploadAsset(token, authorUrn, mediaItem) {
    const isVideo = mediaItem.mime_type?.startsWith('video')
    const recipe = isVideo
      ? 'urn:li:digitalmediaRecipe:feedshare-video'
      : 'urn:li:digitalmediaRecipe:feedshare-image'

    // Step 1: register upload
    const registerRes = await axios.post(
      `${API_BASE}/assets?action=registerUpload`,
      {
        registerUploadRequest: {
          recipes: [recipe],
          owner: authorUrn,
          serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }],
        },
      },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    )

    const uploadUrl = registerRes.data?.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl
    const assetUrn = registerRes.data?.value?.asset

    if (!uploadUrl || !assetUrn) throw new Error('LinkedIn asset registration failed')

    // Step 2: upload the binary
    const fileRes = await axios.get(mediaItem.url, { responseType: 'arraybuffer' })
    await axios.put(uploadUrl, fileRes.data, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': mediaItem.mime_type || 'application/octet-stream',
      },
    })

    return assetUrn
  }

  hasEntities() { return false }
  getCharLimit() { return 3000 }
  getMediaLimit() { return { photos: 9, videos: 1, gifs: 0, mixed: false } }
}
