import axios from 'axios'

export class MastodonProvider {
  constructor(config = {}, account = null) {
    this.config = config
    this.account = account
    this.serverUrl = config.server_url || account?.data?.server_url
    this.clientId = config.client_id
    this.clientSecret = config.client_secret
    this.callbackUrl = process.env.MASTODON_CALLBACK_URL || `${process.env.API_URL || 'http://localhost:3001'}/callback/mastodon`
  }

  _api(endpoint) {
    if (!this.serverUrl) throw new Error('Mastodon server URL is required')
    return `${this.serverUrl}/api/v1/${endpoint}`
  }

  async getAuthUrl() {
    if (!this.clientId) throw new Error('Mastodon app not configured. Create it first via Services.')
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.callbackUrl,
      scope: 'read write',
      response_type: 'code',
    })
    return `${this.serverUrl}/oauth/authorize?${params}`
  }

  async handleCallback({ code }) {
    const tokenRes = await axios.post(`${this.serverUrl}/oauth/token`, {
      grant_type: 'authorization_code',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.callbackUrl,
      code,
    })
    const { access_token } = tokenRes.data

    const meRes = await axios.get(this._api('accounts/verify_credentials'), {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    const me = meRes.data

    return {
      provider: 'mastodon',
      provider_id: me.id,
      name: me.display_name || me.username,
      username: me.username,
      media: { avatar: me.avatar },
      data: { server_url: this.serverUrl, followers_count: me.followers_count },
      access_token: { token: access_token },
      authorized: true,
    }
  }

  _token() {
    return this.account?.access_token?.token
  }

  async getAccount() {
    const res = await axios.get(this._api('accounts/verify_credentials'), {
      headers: { Authorization: `Bearer ${this._token()}` },
    })
    const me = res.data
    return {
      name: me.display_name || me.username,
      username: me.username,
      media: { avatar: me.avatar },
      data: { server_url: this.serverUrl, followers_count: me.followers_count },
    }
  }

  async publishPost(version) {
    const content = version.content || []
    const textBlock = content.find(b => b.type === 'text')
    const mediaBlocks = content.filter(b => b.type === 'media')
    const status = textBlock?.body || ''

    // Upload media attachments
    const mediaIds = []
    for (const block of mediaBlocks) {
      for (const item of block.media || []) {
        const mediaId = await this._uploadMedia(item)
        if (mediaId) mediaIds.push(mediaId)
      }
    }

    const payload = { status }
    if (mediaIds.length) payload.media_ids = mediaIds

    // Idempotency-Key prevents duplicate posts if the request is retried
    const { randomUUID } = await import('crypto')
    const res = await axios.post(this._api('statuses'), payload, {
      headers: { Authorization: `Bearer ${this._token()}`, 'Idempotency-Key': randomUUID() },
    })
    return { provider_post_id: res.data.id, url: res.data.url }
  }

  async _uploadMedia(mediaItem) {
    try {
      const { default: axiosLib } = await import('axios')
      const response = await axiosLib.get(mediaItem.url, { responseType: 'arraybuffer' })
      const FormData = (await import('form-data')).default
      const form = new FormData()
      form.append('file', Buffer.from(response.data), { filename: 'media', contentType: mediaItem.mime_type })
      // Use v2 media endpoint (supports larger files and async processing)
      // Mirrors original: "$this->serverUrl/api/v2/media"
      const res = await axiosLib.post(`${this.serverUrl}/api/v2/media`, form, {
        headers: { ...form.getHeaders(), Authorization: `Bearer ${this._token()}` },
      })
      return res.data.id
    } catch (err) {
      console.error('[Mastodon] Media upload failed:', err.message)
      return null
    }
  }

  async getFollowers() {
    const res = await axios.get(this._api('accounts/verify_credentials'), {
      headers: { Authorization: `Bearer ${this._token()}` },
    })
    return res.data.followers_count
  }

  hasEntities() { return false }
  getCharLimit() { return 500 }
  getMediaLimit() { return { photos: 4, videos: 1, gifs: 1, mixed: true } }
}

// Create a new Mastodon app on a given instance
export async function createMastodonApp(serverUrl) {
  const callbackUrl = process.env.MASTODON_CALLBACK_URL || `${process.env.API_URL || 'http://localhost:3001'}/callback/mastodon`
  const res = await axios.post(`${serverUrl}/api/v1/apps`, {
    client_name: 'Mixpost',
    redirect_uris: callbackUrl,
    scopes: 'read write',
    website: process.env.NEXT_PUBLIC_WEB_URL || 'http://localhost:3000',
  })
  return { client_id: res.data.client_id, client_secret: res.data.client_secret, server_url: serverUrl }
}
