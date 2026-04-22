import axios from 'axios'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const ADS_BASE = 'https://googleads.googleapis.com/v17'

// Required OAuth scopes for Google Ads API
const SCOPES = [
  'https://www.googleapis.com/auth/adwords',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ')

export class GoogleAdsProvider {
  constructor(config = {}, account = null) {
    this.config = config
    this.account = account
    this.clientId = config.client_id || process.env.GOOGLE_ADS_CLIENT_ID
    this.clientSecret = config.client_secret || process.env.GOOGLE_ADS_CLIENT_SECRET
    this.developerToken = config.developer_token || process.env.GOOGLE_ADS_DEVELOPER_TOKEN
    this.callbackUrl = process.env.GOOGLE_ADS_CALLBACK_URL
      || `${process.env.API_URL || 'http://localhost:4010'}/api/integrations/google-ads/callback`
  }

  async getAuthUrl() {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.callbackUrl,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent',  // force refresh_token on every auth
    })
    return `${AUTH_URL}?${params}`
  }

  async handleCallback({ code }) {
    // Exchange code for tokens
    const tokenRes = await axios.post(TOKEN_URL, new URLSearchParams({
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.callbackUrl,
      grant_type: 'authorization_code',
    }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })

    const { access_token, refresh_token, expires_in } = tokenRes.data

    // Get user profile info
    const profileRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    const profile = profileRes.data

    // Get accessible Google Ads customer IDs
    let customerId = null
    let customerName = profile.name || profile.email
    
    if (!this.developerToken) {
      console.error('[GoogleAds] Developer token not configured — cannot fetch customer ID')
    } else {
      try {
        const customersRes = await axios.get(`${ADS_BASE}/customers:listAccessibleCustomers`, {
          headers: this._headers(access_token),
        })
        const resourceNames = customersRes.data.resourceNames || []
        if (resourceNames.length > 0) {
          // Use first accessible customer
          customerId = resourceNames[0].replace('customers/', '')
        } else {
          console.warn('[GoogleAds] No accessible customer IDs found for this account')
        }
      } catch (err) {
        console.error('[GoogleAds] Failed to fetch customer ID:', {
          status: err.response?.status,
          message: err.response?.data?.error?.message || err.message,
        })
      }
    }

    return {
      provider: 'google_ads',
      provider_id: profile.id || profile.sub,
      name: profile.name || profile.email,
      username: profile.email,
      media: { avatar: profile.picture || null },
      data: {
        customer_id: customerId,
        email: profile.email,
      },
      access_token: {
        token: access_token,
        refresh_token,
        expires_at: expires_in ? new Date(Date.now() + expires_in * 1000).toISOString() : null,
      },
      authorized: true,
    }
  }

  async getAccount() {
    const token = await this._getValidToken()
    const customerId = this.account?.data?.customer_id
    if (!customerId) return { name: this.account?.name, username: this.account?.username, data: this.account?.data || {} }

    try {
      const res = await axios.post(
        `${ADS_BASE}/customers/${customerId}/googleAds:search`,
        { query: 'SELECT customer.id, customer.descriptive_name, customer.currency_code FROM customer LIMIT 1' },
        { headers: this._headers(token) }
      )
      const row = res.data?.results?.[0]?.customer
      return {
        name: row?.descriptiveName || this.account?.name,
        username: this.account?.username,
        media: this.account?.media || {},
        data: { ...this.account?.data, currency: row?.currencyCode },
      }
    } catch {
      return { name: this.account?.name, username: this.account?.username, data: this.account?.data || {} }
    }
  }

  // Sync campaigns from Google Ads API into local ads_campaigns collection
  async syncCampaigns() {
    const token = await this._getValidToken()
    const customerId = this.account?.data?.customer_id
    if (!customerId) throw new Error('No Google Ads customer_id associated with this account')

    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign.start_date,
        campaign.end_date,
        campaign_budget.amount_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr
      FROM campaign
      WHERE campaign.status != 'REMOVED'
      ORDER BY campaign.name
    `

    const res = await axios.post(
      `${ADS_BASE}/customers/${customerId}/googleAds:search`,
      { query },
      { headers: this._headers(token) }
    )

    const rows = res.data?.results || []
    return rows.map(row => {
      const c = row.campaign
      const m = row.metrics || {}
      const budget = row.campaign_budget

      // Convert micros to dollars
      const budgetAmount = budget?.amountMicros ? budget.amountMicros / 1_000_000 : 0
      const spend = m.costMicros ? m.costMicros / 1_000_000 : 0

      return {
        google_campaign_id: c.id,
        name: c.name,
        platform: 'google_ads',
        type: this._mapChannelType(c.advertisingChannelType),
        status: this._mapStatus(c.status),
        budget: { amount: budgetAmount, currency: 'USD', type: 'daily' },
        start_date: c.startDate || null,
        end_date: c.endDate || null,
        metrics: {
          impressions: parseInt(m.impressions || 0),
          clicks: parseInt(m.clicks || 0),
          spend: parseFloat(spend.toFixed(2)),
          conversions: parseFloat(m.conversions || 0),
          ctr: parseFloat(m.ctr || 0),
          cpc: m.clicks > 0 ? parseFloat((spend / m.clicks).toFixed(4)) : 0,
        },
      }
    })
  }

  // Google Ads API does not support post publishing — this provider is for ads only
  async publishPost() {
    throw new Error('Google Ads accounts cannot publish social posts')
  }

  // ── Token management ────────────────────────────────────────────────────────

  async _getValidToken() {
    const accessToken = this.account?.access_token?.token
    const refreshToken = this.account?.access_token?.refresh_token
    const expiresAt = this.account?.access_token?.expires_at

    // Refresh if expired or within 2 minutes of expiry
    if (expiresAt && new Date(expiresAt) < new Date(Date.now() + 120_000)) {
      if (!refreshToken) throw new Error('No refresh token — please reconnect Google Ads')
      return this._refreshToken(refreshToken)
    }
    return accessToken
  }

  async _refreshToken(refreshToken) {
    const res = await axios.post(TOKEN_URL, new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })

    const { access_token, expires_in } = res.data

    // Persist updated token to DB
    if (this.account?._id) {
      const { getDb } = await import('../db/mongodb.js')
      const { ObjectId } = await import('mongodb')
      await getDb().collection('accounts').updateOne(
        { _id: new ObjectId(this.account._id.toString()) },
        {
          $set: {
            'access_token.token': access_token,
            'access_token.expires_at': new Date(Date.now() + expires_in * 1000).toISOString(),
            updated_at: new Date(),
          },
        }
      )
    }
    return access_token
  }

  _headers(token) {
    return {
      Authorization: `Bearer ${token}`,
      'developer-token': this.developerToken,
      'Content-Type': 'application/json',
    }
  }

  _mapStatus(status) {
    const map = { ENABLED: 'active', PAUSED: 'paused', REMOVED: 'ended' }
    return map[status] || 'draft'
  }

  _mapChannelType(type) {
    const map = {
      SEARCH: 'search',
      DISPLAY: 'display',
      SHOPPING: 'shopping',
      VIDEO: 'video',
      SMART: 'smart',
      PERFORMANCE_MAX: 'performance_max',
    }
    return map[type] || 'search'
  }

  hasEntities() { return false }
  getCharLimit() { return 0 }
  getMediaLimit() { return { photos: 0, videos: 0, gifs: 0, mixed: false } }
}
