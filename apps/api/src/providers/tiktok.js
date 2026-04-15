import axios from 'axios'
import crypto from 'crypto'

const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/'
const AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/'
const USERINFO_URL = 'https://open.tiktokapis.com/v2/user/info/'
const CREATOR_INFO_URL = 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/'
const PUBLISH_INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/video/init/'
const PUBLISH_STATUS_URL = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/'

export class TikTokProvider {
  constructor(config = {}, account = null) {
    this.config = config
    this.account = account
    this.clientKey = config.client_key || process.env.TIKTOK_CLIENT_KEY
    this.clientSecret = config.client_secret || process.env.TIKTOK_CLIENT_SECRET
    this.callbackUrl = process.env.TIKTOK_CALLBACK_URL || `${process.env.API_URL || 'http://localhost:3001'}/callback/tiktok`
  }

  async getAuthUrl() {
    // PKCE flow
    const codeVerifier = crypto.randomBytes(64).toString('base64url')
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
    const state = crypto.randomBytes(16).toString('hex')

    // Store verifier in Redis keyed by state
    const { getRedis } = await import('../db/redis.js')
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
    const { getRedis } = await import('../db/redis.js')
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

  async publishPost(version) {
    const token = this.account?.access_token?.token
    const content = version.content || []
    const textBlock = content.find(b => b.type === 'text')
    const mediaBlocks = content.filter(b => b.type === 'media')
    const title = textBlock?.body || ''

    // Find the first video in media blocks
    const allMedia = mediaBlocks.flatMap(b => b.media || [])
    const videoItem = allMedia.find(m => m.mime_type?.startsWith('video'))

    if (!videoItem?.url) throw new Error('TikTok requires a video to publish')

    // Fetch the video file and upload it directly (FILE_UPLOAD) so no domain
    // verification is needed. Pull-from-URL requires TikTok domain verification.
    const fs = await import('fs')
    const path = await import('path')
    const { pipeline } = await import('stream/promises')

    // Resolve local file path from URL (media is served from the local uploads dir)
    const uploadDir = process.env.STORAGE_LOCAL_PATH || './uploads'
    const urlPath = new URL(videoItem.url).pathname  // e.g. /uploads/abc.mp4
    const filename = urlPath.replace(/^\/uploads\//, '')
    const localPath = path.join(uploadDir, filename)

    const stat = await fs.promises.stat(localPath)
    const videoSize = stat.size

    // Step 1 — query creator info to get allowed privacy levels (required by TikTok)
    let privacyLevel = 'SELF_ONLY'
    try {
      const creatorRes = await axios.post(
        CREATOR_INFO_URL,
        {},
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' } }
      )
      const options = creatorRes.data?.data?.privacy_level_options || []
      // Until the app is audited by TikTok, direct posting only works with SELF_ONLY.
      // After audit approval, switch to: PUBLIC_TO_EVERYONE → MUTUAL_FOLLOW_FRIENDS → SELF_ONLY
      privacyLevel = options.includes('SELF_ONLY') ? 'SELF_ONLY'
        : options[0] || 'SELF_ONLY'
      console.log(`[TikTok] privacy options: ${JSON.stringify(options)} → using ${privacyLevel}`)
    } catch (e) {
      console.warn(`[TikTok] creator info query failed: ${e.message || e.code || JSON.stringify(e.response?.data)}, defaulting to SELF_ONLY`)
    }

    // Step 2 — init direct post (video.publish scope, posts directly to profile)
    console.log(`[TikTok] init direct post: size=${videoSize} file=${localPath}`)
    let initRes
    try {
      initRes = await axios.post(
        PUBLISH_INIT_URL,
        {
          post_info: {
            title: title.slice(0, 150),
            privacy_level: privacyLevel,
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false,
          },
          source_info: {
            source: 'FILE_UPLOAD',
            video_size: videoSize,
            chunk_size: videoSize,
            total_chunk_count: 1,
          },
        },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' } }
      )
    } catch (e) {
      const body = e.response?.data
      throw new Error(`TikTok init HTTP ${e.response?.status} code=${e.code}: ${JSON.stringify(body)}`)
    }
    console.log(`[TikTok] init response: ${JSON.stringify(initRes.data)}`)

    // TikTok wraps errors in data.error even on 200
    if (initRes.data?.error?.code && initRes.data.error.code !== 'ok') {
      throw new Error(`TikTok: ${initRes.data.error.message} (${initRes.data.error.code})`)
    }

    const publishId = initRes.data?.data?.publish_id
    const uploadUrl = initRes.data?.data?.upload_url
    if (!publishId || !uploadUrl) {
      throw new Error(`TikTok init failed: ${JSON.stringify(initRes.data)}`)
    }

    // Step 3 — upload the video in one chunk
    console.log(`[TikTok] uploading to: ${uploadUrl}`)
    const videoBuffer = await fs.promises.readFile(localPath)
    const uploadRes = await axios.put(uploadUrl, videoBuffer, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Range': `bytes 0-${videoSize - 1}/${videoSize}`,
        'Content-Length': videoSize,
      },
    })
    console.log(`[TikTok] upload response: ${uploadRes.status} ${JSON.stringify(uploadRes.data)}`)

    // Step 4 — poll until published
    const postId = await this._pollPublishStatus(publishId, token)
    return { provider_post_id: postId }
  }

  async _pollPublishStatus(publishId, token, retries = 20) {
    for (let i = 0; i < retries; i++) {
      await new Promise(r => setTimeout(r, 3000))
      const res = await axios.post(
        PUBLISH_STATUS_URL,
        { publish_id: publishId },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' } }
      )
      // TikTok wraps errors in data.error even on 200
      if (res.data?.error?.code && res.data.error.code !== 'ok') {
        throw new Error(`TikTok: ${res.data.error.message} (${res.data.error.code})`)
      }
      const status = res.data?.data?.status
      if (status === 'PUBLISH_COMPLETE' || status === 'SEND_TO_USER_INBOX') {
        return res.data?.data?.publicaly_available_post_id?.[0] || publishId
      }
      if (status === 'FAILED') throw new Error(`TikTok publish failed: ${res.data?.data?.fail_reason || 'unknown'}`)
    }
    throw new Error('TikTok publish timed out')
  }

  hasEntities() { return false }
  getCharLimit() { return 150 }
  getMediaLimit() { return { photos: 0, videos: 1, gifs: 0, mixed: false } }
}
