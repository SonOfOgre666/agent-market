/**
 * LinkedIn member API + OAuth 2.0.
 *
 * OAuth (API): getAuthUrl, handleCallback (token exchange + profile/email during connect).
 * Execution: getAccount. **Publishing** — worker only (`tasks.social.publish_post` → `connectors.linkedin`).
 */
import axios from 'axios'

const AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization'
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken'
const API_BASE = 'https://api.linkedin.com/v2'

const SCOPES = [
  'openid',
  'profile',
  'email',
  'w_member_social',
  'w_member_social_feed',
  'r_member_social_feed',
].join(' ')

export class LinkedInProvider {
  constructor(config = {}, account = null) {
    this.config = config
    this.account = account
    this.clientId = config.client_id || process.env.LINKEDIN_CLIENT_ID
    this.clientSecret = config.client_secret || process.env.LINKEDIN_CLIENT_SECRET
    this.callbackUrl = process.env.LINKEDIN_CALLBACK_URL
      || `${process.env.API_URL || 'http://localhost:4010'}/api/integrations/linkedin/callback`
  }

  async getAuthUrl() {
    if (!this.clientId) {
      throw new Error('LinkedIn Client ID is not configured. Save it under Integrations → LinkedIn.')
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.callbackUrl,
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

    const userinfoRes = await axios.get(`${API_BASE}/userinfo`, {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    const profile = userinfoRes.data
    const name = (profile.name || `${profile.given_name || ''} ${profile.family_name || ''}`).trim()
    const avatar = profile.picture || null

    return {
      provider: 'linkedin',
      provider_id: profile.sub,
      name,
      username: name,
      media: { avatar },
      data: profile.email ? { email: profile.email } : {},
      access_token: { token: access_token },
      authorized: true,
    }
  }

  async getAccount() {
    const token = this.account?.access_token?.token
    const res = await axios.get(`${API_BASE}/userinfo`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const profile = res.data
    const name = (profile.name || `${profile.given_name || ''} ${profile.family_name || ''}`).trim()
    return { name, username: name, media: { avatar: profile.picture || null }, data: {} }
  }

  async publishPost() {
    throw new Error(
      'LinkedIn publishing runs in the worker (tasks.social.publish_post → connectors.linkedin). API routes must use dispatchPublishPost only.',
    )
  }

  hasEntities() { return false }
  getCharLimit() { return 3000 }
  getMediaLimit() { return { photos: 9, videos: 1, gifs: 0, mixed: false } }
}
