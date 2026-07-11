/**
 * Google Ads — OAuth + Marketing API (google-ads-api SDK).
 *
 * OAuth (API): getAuthUrl, handleCallback (tokens only), getEntities + saveEntity (customer picker).
 * Execution: getAccount, syncCampaigns, runQuery, reporting helpers (legacy path in routes when
 *   ``LEGACY_API_EXECUTION_ADS=1``). **Campaign create + remote status mutations** — worker only
 *   (`tasks.ads.publish_campaign` → ``connectors.google_ads.execute_publish_campaign_mutations``;
 *   ``tasks.ads.update_remote_campaign_status``). **Social-style publishPost** — unsupported (Google Ads accounts).
 */
import axios from 'axios'
import { GoogleAdsApi } from 'google-ads-api'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

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
      || `${process.env.API_URL || 'http://localhost:4010'}/callback/google_ads`
  }

  // Returns a configured GoogleAdsApi client (no token — tokens come from Customer)
  _client() {
    return new GoogleAdsApi({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      developer_token: this.developerToken,
    })
  }

  static _digitsCustomerId(id) {
    return String(id || '').replace(/\D/g, '')
  }

  static _formatCustomerIdDisplay(id) {
    const d = GoogleAdsProvider._digitsCustomerId(id)
    if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
    return d || ''
  }

  static _accountTypeLabel({ manager, status }) {
    if (manager) {
      const st = status ? ` (${status})` : ''
      return `Manager${st}`
    }
    return 'Ads Account'
  }

  static _isInactiveCustomerStatus(status, testAccount = false) {
    if (testAccount) return false
    const s = String(status || '').toUpperCase()
    return s === 'CLOSED' || s === 'CANCELED' || s === 'CANCELLED' || s === 'SUSPENDED'
  }

  static _managerLinkStatusActive(status) {
    const s = String(status ?? '').toUpperCase()
    if (!s) return true
    return s === 'ACTIVE' || s === '2'
  }

  static _parseManagerCustomerId(raw) {
    if (raw == null) return null
    const text = typeof raw === 'object'
      ? String(raw.resource_name || raw.resourceName || raw.id || '')
      : String(raw)
    const digits = GoogleAdsProvider._digitsCustomerId(text.replace(/^customers\//, ''))
    return digits || null
  }

  _customerHandle(refreshToken, customerId, loginCustomerId = null) {
    const cid = GoogleAdsProvider._digitsCustomerId(customerId)
    const opts = { customer_id: cid, refresh_token: refreshToken }
    const loginCid = loginCustomerId
      ? GoogleAdsProvider._digitsCustomerId(loginCustomerId)
      : null
    if (loginCid && loginCid !== cid) opts.login_customer_id = loginCid
    return this._client().Customer(opts)
  }

  async _fetchActiveManagerIdsFromClientLink(refreshToken, clientId) {
    try {
      const rows = await this._customerHandle(refreshToken, clientId).query(`
        SELECT
          customer_manager_link.manager_customer,
          customer_manager_link.status
        FROM customer_manager_link
        WHERE customer_manager_link.status = 'ACTIVE'
      `)
      const managerIds = []
      for (const row of rows || []) {
        const link = row.customer_manager_link || row.customerManagerLink
        if (!link) continue
        if (!GoogleAdsProvider._managerLinkStatusActive(link.status)) continue
        const id = GoogleAdsProvider._parseManagerCustomerId(
          link.manager_customer || link.managerCustomer,
        )
        if (id) managerIds.push(id)
      }
      return managerIds
    } catch {
      return []
    }
  }

  async _managerContainsClient(refreshToken, managerId, clientId) {
    try {
      const rows = await this._customerHandle(refreshToken, managerId).query(`
        SELECT customer_client.id, customer_client.status
        FROM customer_client
        WHERE customer_client.id = ${GoogleAdsProvider._digitsCustomerId(clientId)}
          AND customer_client.level = 1
        LIMIT 1
      `)
      const row = rows?.[0]?.customer_client || rows?.[0]?.customerClient
      if (!row) return false
      return !GoogleAdsProvider._isInactiveCustomerStatus(row.status)
    } catch {
      return false
    }
  }

  /**
   * List direct client accounts under a manager (MCC). Test clients created under a
   * test manager often do not appear in listAccessibleCustomers — only the manager does.
   */
  async _fetchManagerClientEntities(refreshToken, managerEntity) {
    const managerId = GoogleAdsProvider._digitsCustomerId(managerEntity.customer_id)
    if (!managerId || !managerEntity.manager) return []

    try {
      const rows = await this._customerHandle(refreshToken, managerId).query(`
        SELECT
          customer_client.id,
          customer_client.descriptive_name,
          customer_client.currency_code,
          customer_client.manager,
          customer_client.status,
          customer_client.test_account,
          customer_client.level
        FROM customer_client
        WHERE customer_client.level = 1
      `)
      const clients = []
      for (const row of rows || []) {
        const cc = row.customer_client || row.customerClient
        if (!cc) continue
        if (Boolean(cc.manager)) continue
        const clientId = GoogleAdsProvider._digitsCustomerId(cc.id)
        if (!clientId || clientId === managerId) continue
        const status = cc.status != null ? String(cc.status) : null
        const testAccount = Boolean(cc.test_account ?? cc.testAccount)
        if (GoogleAdsProvider._isInactiveCustomerStatus(status, testAccount)) continue
        clients.push({
          type: 'google_ads',
          id: clientId,
          customer_id: clientId,
          customer_id_display: GoogleAdsProvider._formatCustomerIdDisplay(clientId),
          name: cc.descriptive_name || `Customer ${clientId}`,
          currency: cc.currency_code || cc.currencyCode || null,
          manager: false,
          test_account: testAccount,
          status,
          account_type: 'client',
          account_type_label: testAccount ? 'Test Ads Account' : 'Ads Account',
          email: managerEntity.email || this.account?.username || this.account?.data?.email || null,
          login_customer_id: managerId,
          manager_customer_id: managerId,
          manager_name: managerEntity.name || null,
        })
      }
      return clients
    } catch (err) {
      console.warn('[GoogleAds] manager client list failed for %s: %s', managerId, err.message)
      return []
    }
  }

  /**
   * Resolve the manager (MCC) that should be sent as login-customer-id for a client account.
   * Uses customer_manager_link on the client, then falls back to scanning accessible managers.
   */
  async _resolveLoginCustomerIdForClient(refreshToken, clientId, activeManagerIdSet) {
    const cid = GoogleAdsProvider._digitsCustomerId(clientId)
    if (!cid || !activeManagerIdSet?.size) return null

    const linkedManagerIds = await this._fetchActiveManagerIdsFromClientLink(refreshToken, cid)
    const linkedAccessible = linkedManagerIds.filter((id) => activeManagerIdSet.has(id))
    if (linkedAccessible.length === 1) return linkedAccessible[0]
    if (linkedAccessible.length > 1) return linkedAccessible[0]

    for (const managerId of activeManagerIdSet) {
      if (await this._managerContainsClient(refreshToken, managerId, cid)) {
        return managerId
      }
    }
    return null
  }

  _loginCustomerIdForApi() {
    const stored = this.account?.data?.login_customer_id
    if (stored && String(stored).replace(/\D/g, '')) {
      return GoogleAdsProvider._digitsCustomerId(stored)
    }
    const env = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
    if (env && String(env).replace(/\D/g, '')) {
      return GoogleAdsProvider._digitsCustomerId(env)
    }
    return null
  }

  // Returns a Customer bound to the stored refresh_token — SDK handles token refresh automatically
  _customer(customerId) {
    const refreshToken = this.account?.access_token?.refresh_token
    if (!refreshToken) throw new Error('No refresh token — please reconnect Google Ads')
    const cid = GoogleAdsProvider._digitsCustomerId(customerId)
    const opts = {
      customer_id: cid,
      refresh_token: refreshToken,
    }
    const loginCid = this._loginCustomerIdForApi()
    if (loginCid && loginCid !== cid) {
      opts.login_customer_id = loginCid
    }
    return this._client().Customer(opts)
  }

  /**
   * List customer resource names for a refresh token.
   * google-ads-api: ``client.listAccessibleCustomers(refreshToken)`` — NOT on Customer.
   */
  async _listAccessibleCustomerResourceNames(refreshToken) {
    if (!refreshToken) throw new Error('No refresh token — reconnect Google Ads')
    if (!this.developerToken) {
      throw new Error(
        'Google Ads developer token is not configured. Add it under Integrations → Google Ads.',
      )
    }
    const client = this._client()
    const res = await client.listAccessibleCustomers(refreshToken)
    if (Array.isArray(res)) return res
    if (Array.isArray(res?.resource_names)) return res.resource_names
    if (Array.isArray(res?.resourceNames)) return res.resourceNames
    return []
  }

  // ── OAuth ────────────────────────────────────────────────────────────────────

  async getAuthUrl() {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.callbackUrl,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent',   // always issue a fresh refresh_token
    })
    return `${AUTH_URL}?${params}`
  }

  async handleCallback({ code }) {
    // Exchange authorization code for tokens
    const tokenRes = await axios.post(TOKEN_URL, new URLSearchParams({
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.callbackUrl,
      grant_type: 'authorization_code',
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })

    const { access_token, refresh_token, expires_in } = tokenRes.data

    // Fetch Google profile info
    const profileRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    const profile = profileRes.data
    const googleUserId = profile.id || profile.sub

    // Tokens only — user picks customer_id on /accounts/entities (Meta-style).
    if (!this.developerToken) {
      console.warn('[GoogleAds] Developer token not configured — customer list will fail until configured')
    }

    return {
      provider: 'google_ads',
      provider_id: googleUserId,
      name: profile.name || profile.email,
      username: profile.email,
      media: { avatar: profile.picture || null },
      data: {
        email: profile.email,
        google_user_id: googleUserId,
      },
      access_token: {
        token: access_token,
        refresh_token,
        expires_at: expires_in ? new Date(Date.now() + expires_in * 1000).toISOString() : null,
      },
      authorized: true,
      pending_entities: true,
    }
  }

  hasEntities() {
    return true
  }

  /** List accessible Google Ads customer accounts (same as worker ``google_get_ad_accounts``). */
  async getEntities() {
    const refreshToken = this.account?.access_token?.refresh_token
    if (!refreshToken) throw new Error('No refresh token — reconnect Google Ads')

    if (!this.developerToken) {
      throw new Error(
        'Google Ads developer token is not configured. Add it under Integrations → Google Ads or GOOGLE_ADS_DEVELOPER_TOKEN.',
      )
    }

    const client = this._client()
    let resourceNames = []
    try {
      resourceNames = await this._listAccessibleCustomerResourceNames(refreshToken)
    } catch (err) {
      console.error('[GoogleAds] listAccessibleCustomers failed:', err.message)
      throw new Error(err.message || 'Failed to list Google Ads customers')
    }

    const entities = []
    for (const rn of resourceNames) {
      const id = GoogleAdsProvider._digitsCustomerId(String(rn).replace('customers/', ''))
      if (!id) continue
      let name = `Customer ${id}`
      let currency = null
      let manager = false
      let status = null
      let testAccount = false
      try {
        const row = await client.Customer({
          customer_id: id,
          refresh_token: refreshToken,
        }).query(`
          SELECT
            customer.descriptive_name,
            customer.currency_code,
            customer.manager,
            customer.status,
            customer.test_account
          FROM customer
          LIMIT 1
        `)
        if (row?.[0]?.customer) {
          const c = row[0].customer
          name = c.descriptive_name || name
          currency = c.currency_code || c.currencyCode || null
          manager = Boolean(c.manager)
          status = c.status != null ? String(c.status) : null
          testAccount = Boolean(c.test_account ?? c.testAccount)
        }
      } catch {
        /* label optional */
      }
      entities.push({
        type: 'google_ads',
        id,
        customer_id: id,
        customer_id_display: GoogleAdsProvider._formatCustomerIdDisplay(id),
        name,
        currency,
        manager,
        test_account: testAccount,
        status,
        account_type: manager ? 'manager' : 'client',
        account_type_label: GoogleAdsProvider._accountTypeLabel({ manager, status }),
        email: this.account?.username || this.account?.data?.email || null,
      })
    }

    const seenIds = new Set(entities.map((e) => e.customer_id))
    for (const ent of [...entities]) {
      if (!ent.manager || GoogleAdsProvider._isInactiveCustomerStatus(ent.status)) continue
      const children = await this._fetchManagerClientEntities(refreshToken, ent)
      for (const child of children) {
        if (seenIds.has(child.customer_id)) continue
        entities.push(child)
        seenIds.add(child.customer_id)
      }
    }

    const activeManagerIdSet = new Set(
      entities
        .filter((e) => e.manager && !GoogleAdsProvider._isInactiveCustomerStatus(e.status))
        .map((e) => e.customer_id),
    )
    for (const ent of entities) {
      if (ent.manager) {
        ent.login_customer_id = null
        continue
      }
      if (ent.login_customer_id) continue
      const loginCustomerId = await this._resolveLoginCustomerIdForClient(
        refreshToken,
        ent.customer_id,
        activeManagerIdSet,
      )
      ent.login_customer_id = loginCustomerId && loginCustomerId !== ent.customer_id
        ? loginCustomerId
        : null
    }
    return entities
  }

  async saveEntity(entity, user_id, workspace_id) {
    const { upsertAccount } = await import('../models/Account.js')
    const customerId = GoogleAdsProvider._digitsCustomerId(entity.customer_id || entity.id)
    if (!customerId) throw new Error('Google Ads customer_id is required')

    const refreshToken = this.account?.access_token?.refresh_token
    if (!refreshToken) throw new Error('OAuth session expired — reconnect Google Ads')

    let loginCustomerId = entity.login_customer_id != null
      ? GoogleAdsProvider._digitsCustomerId(entity.login_customer_id) || null
      : null
    if (!loginCustomerId && !entity.manager) {
      try {
        const listed = await this.getEntities()
        const match = listed.find((e) => e.customer_id === customerId)
        loginCustomerId = match?.login_customer_id
          ? GoogleAdsProvider._digitsCustomerId(match.login_customer_id) || null
          : null
      } catch {
        /* optional */
      }
    }
    if (loginCustomerId === customerId) loginCustomerId = null

    const googleUserId = this.account?.provider_id
      || this.account?.data?.google_user_id
      || null

    return upsertAccount({
      workspace_id: workspace_id || null,
      provider: 'google_ads',
      provider_id: googleUserId || customerId,
      name: entity.name || `Google Ads ${customerId}`,
      username: entity.email || this.account?.username || null,
      media: this.account?.media || {},
      data: {
        customer_id: customerId,
        login_customer_id: loginCustomerId || null,
        email: entity.email || this.account?.data?.email || null,
        google_user_id: googleUserId,
        currency: entity.currency || null,
        account_type: entity.account_type || (entity.manager ? 'manager' : 'client'),
        account_type_label: entity.account_type_label || null,
        customer_status: entity.status || null,
      },
      access_token: this.account?.access_token || {},
      authorized: true,
      pending_entities: false,
    })
  }

  // ── Account info ─────────────────────────────────────────────────────────────

  async getAccount() {
    const customerId = this.account?.data?.customer_id
    if (!customerId) return { name: this.account?.name, username: this.account?.username, data: this.account?.data || {} }

    try {
      const customer = this._customer(customerId)
      const [row] = await customer.query(`
        SELECT customer.id, customer.descriptive_name, customer.currency_code
        FROM customer LIMIT 1
      `)
      return {
        name: row?.customer?.descriptive_name || this.account?.name,
        username: this.account?.username,
        media: this.account?.media || {},
        data: { ...this.account?.data, currency: row?.customer?.currency_code },
      }
    } catch {
      return { name: this.account?.name, username: this.account?.username, data: this.account?.data || {} }
    }
  }

  // ── Campaigns ─────────────────────────────────────────────────────────────────

  // Pull all active/paused campaigns with metrics into local format
  async syncCampaigns() {
    const customerId = this.account?.data?.customer_id
    if (!customerId) throw new Error('No Google Ads customer_id associated with this account')

    const customer = this._customer(customerId)
    const rows = await customer.query(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign.start_date,
        campaign.end_date,
        campaign_budget.amount_micros,
        customer.currency_code,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr
      FROM campaign
      WHERE campaign.status != 'REMOVED'
      ORDER BY campaign.name
    `)

    return rows.map(({ campaign, campaign_budget, customer: cust, metrics }) => {
      const budgetAmount = campaign_budget?.amount_micros ? campaign_budget.amount_micros / 1_000_000 : 0
      const spend = metrics?.cost_micros ? metrics.cost_micros / 1_000_000 : 0
      const currency = cust?.currency_code || cust?.currencyCode || 'USD'
      return {
        google_campaign_id: campaign.id,
        name: campaign.name,
        platform: 'google_ads',
        type: this._mapChannelType(campaign.advertising_channel_type),
        status: this._mapStatus(campaign.status),
        budget: { amount: budgetAmount, currency, type: 'daily' },
        start_date: campaign.start_date || null,
        end_date: campaign.end_date || null,
        metrics: {
          impressions: parseInt(metrics?.impressions || 0),
          clicks: parseInt(metrics?.clicks || 0),
          spend: parseFloat(spend.toFixed(2)),
          conversions: parseFloat(metrics?.conversions || 0),
          ctr: parseFloat(metrics?.ctr || 0),
          cpc: metrics?.clicks > 0 ? parseFloat((spend / metrics.clicks).toFixed(4)) : 0,
        },
      }
    })
  }

  async createAdCampaign() {
    throw new Error(
      'Google Ads campaign creation runs in the worker (tasks.ads.publish_campaign → connectors.google_ads.execute_publish_campaign_mutations). Do not call createAdCampaign from apps/api.',
    )
  }

  async updateCampaignStatus() {
    throw new Error(
      'Google Ads remote campaign status updates run in the worker (tasks.ads.update_remote_campaign_status). API routes enqueue that task; do not call updateCampaignStatus from Node.',
    )
  }

  // ── Reporting & Management (ported from aidvertaiser) ───────────────────────

  // Run an arbitrary GAQL query and return results as plain objects.
  // Autocorrects common mistakes: OR→IN, strips WHERE parentheses, adds omit_unselected_resource_names.
  async runQuery(gaqlQuery) {
    const customerId = this.account?.data?.customer_id
    if (!customerId) throw new Error('No Google Ads customer_id associated with this account')
    const customer = this._customer(customerId)
    const query = this._preprocessGaql(gaqlQuery)
    const rows = await customer.query(query)
    return rows.map(row => this._rowToPlain(row))
  }

  // Campaign performance metrics for a date range
  async getCampaignPerformance({ dateRange = 'LAST_30_DAYS', campaignId = null, includeRemoved = false } = {}) {
    const customerId = this.account?.data?.customer_id
    if (!customerId) throw new Error('No Google Ads customer_id associated with this account')
    const customer = this._customer(customerId)

    let query = `
      SELECT
        campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value, metrics.ctr,
        metrics.average_cpc, metrics.cost_per_conversion
      FROM campaign
      WHERE segments.date DURING ${dateRange}
    `
    if (campaignId) query += ` AND campaign.id = ${campaignId}`
    if (!includeRemoved) query += ` AND campaign.status != 'REMOVED'`
    query += ' ORDER BY metrics.cost_micros DESC'

    const rows = await customer.query(query)
    return rows.map(({ campaign, metrics }) => ({
      campaign_id: String(campaign.id),
      campaign_name: campaign.name,
      status: this._mapStatus(campaign.status),
      channel_type: this._mapChannelType(campaign.advertising_channel_type),
      impressions: parseInt(metrics?.impressions || 0),
      clicks: parseInt(metrics?.clicks || 0),
      cost: parseFloat(((metrics?.cost_micros || 0) / 1_000_000).toFixed(2)),
      conversions: parseFloat(metrics?.conversions || 0),
      conversion_value: parseFloat(metrics?.conversions_value || 0),
      ctr: parseFloat(metrics?.ctr || 0),
      average_cpc: parseFloat(((metrics?.average_cpc || 0) / 1_000_000).toFixed(4)),
      cost_per_conversion: parseFloat(((metrics?.cost_per_conversion || 0) / 1_000_000).toFixed(2)),
    }))
  }

  // List ad groups for a campaign
  async listAdGroups({ campaignId = null, status = null } = {}) {
    const customerId = this.account?.data?.customer_id
    if (!customerId) throw new Error('No Google Ads customer_id associated with this account')
    const customer = this._customer(customerId)

    let query = `
      SELECT
        ad_group.id, ad_group.name, ad_group.status, ad_group.type,
        ad_group.cpc_bid_micros,
        campaign.id, campaign.name,
        metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
      FROM ad_group
      WHERE ad_group.status != 'REMOVED'
    `
    if (campaignId) query += ` AND campaign.id = ${campaignId}`
    if (status) query += ` AND ad_group.status = '${status}'`
    query += ' ORDER BY ad_group.name'

    const rows = await customer.query(query)
    return rows.map(({ ad_group, campaign, metrics }) => ({
      ad_group_id: String(ad_group.id),
      ad_group_name: ad_group.name,
      status: this._mapStatus(ad_group.status),
      type: String(ad_group.type || ''),
      cpc_bid: parseFloat(((ad_group.cpc_bid_micros || 0) / 1_000_000).toFixed(4)),
      campaign_id: String(campaign?.id || ''),
      campaign_name: campaign?.name || '',
      impressions: parseInt(metrics?.impressions || 0),
      clicks: parseInt(metrics?.clicks || 0),
      cost: parseFloat(((metrics?.cost_micros || 0) / 1_000_000).toFixed(2)),
      conversions: parseFloat(metrics?.conversions || 0),
    }))
  }

  // Keyword performance report
  async getKeywordPerformance({ dateRange = 'LAST_30_DAYS', campaignId = null, adGroupId = null, minImpressions = 0 } = {}) {
    const customerId = this.account?.data?.customer_id
    if (!customerId) throw new Error('No Google Ads customer_id associated with this account')
    const customer = this._customer(customerId)

    let query = `
      SELECT
        ad_group_criterion.criterion_id, ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type, ad_group_criterion.status,
        ad_group_criterion.quality_info.quality_score,
        campaign.id, campaign.name, ad_group.id, ad_group.name,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.ctr, metrics.average_cpc
      FROM keyword_view
      WHERE segments.date DURING ${dateRange}
        AND ad_group_criterion.status != 'REMOVED'
    `
    if (campaignId) query += ` AND campaign.id = ${campaignId}`
    if (adGroupId) query += ` AND ad_group.id = ${adGroupId}`
    if (minImpressions > 0) query += ` AND metrics.impressions >= ${minImpressions}`
    query += ' ORDER BY metrics.cost_micros DESC'

    const rows = await customer.query(query)
    return rows.map(({ ad_group_criterion, campaign, ad_group, metrics }) => ({
      keyword_id: String(ad_group_criterion?.criterion_id || ''),
      keyword_text: ad_group_criterion?.keyword?.text || '',
      match_type: String(ad_group_criterion?.keyword?.match_type || ''),
      status: this._mapStatus(ad_group_criterion?.status),
      quality_score: ad_group_criterion?.quality_info?.quality_score || null,
      campaign_id: String(campaign?.id || ''),
      campaign_name: campaign?.name || '',
      ad_group_id: String(ad_group?.id || ''),
      ad_group_name: ad_group?.name || '',
      impressions: parseInt(metrics?.impressions || 0),
      clicks: parseInt(metrics?.clicks || 0),
      cost: parseFloat(((metrics?.cost_micros || 0) / 1_000_000).toFixed(2)),
      conversions: parseFloat(metrics?.conversions || 0),
      ctr: parseFloat(metrics?.ctr || 0),
      average_cpc: parseFloat(((metrics?.average_cpc || 0) / 1_000_000).toFixed(4)),
    }))
  }

  // Ad performance report
  async getAdPerformance({ dateRange = 'LAST_30_DAYS', campaignId = null, adGroupId = null } = {}) {
    const customerId = this.account?.data?.customer_id
    if (!customerId) throw new Error('No Google Ads customer_id associated with this account')
    const customer = this._customer(customerId)

    let query = `
      SELECT
        ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.status,
        campaign.id, campaign.name, ad_group.id, ad_group.name,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.ctr, metrics.average_cpc
      FROM ad_group_ad
      WHERE segments.date DURING ${dateRange}
        AND ad_group_ad.status != 'REMOVED'
    `
    if (campaignId) query += ` AND campaign.id = ${campaignId}`
    if (adGroupId) query += ` AND ad_group.id = ${adGroupId}`
    query += ' ORDER BY metrics.cost_micros DESC'

    const rows = await customer.query(query)
    return rows.map(({ ad_group_ad, campaign, ad_group, metrics }) => ({
      ad_id: String(ad_group_ad?.ad?.id || ''),
      ad_type: String(ad_group_ad?.ad?.type || ''),
      status: this._mapStatus(ad_group_ad?.status),
      campaign_id: String(campaign?.id || ''),
      campaign_name: campaign?.name || '',
      ad_group_id: String(ad_group?.id || ''),
      ad_group_name: ad_group?.name || '',
      impressions: parseInt(metrics?.impressions || 0),
      clicks: parseInt(metrics?.clicks || 0),
      cost: parseFloat(((metrics?.cost_micros || 0) / 1_000_000).toFixed(2)),
      conversions: parseFloat(metrics?.conversions || 0),
      ctr: parseFloat(metrics?.ctr || 0),
      average_cpc: parseFloat(((metrics?.average_cpc || 0) / 1_000_000).toFixed(4)),
    }))
  }

  // Search terms report — what users actually searched for when ads showed
  async getSearchTermsReport({ dateRange = 'LAST_30_DAYS', campaignId = null, adGroupId = null, minImpressions = 0 } = {}) {
    const customerId = this.account?.data?.customer_id
    if (!customerId) throw new Error('No Google Ads customer_id associated with this account')
    const customer = this._customer(customerId)

    let query = `
      SELECT
        search_term_view.search_term, search_term_view.status,
        segments.keyword.info.text, segments.keyword.info.match_type,
        campaign.id, campaign.name, ad_group.id, ad_group.name,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.ctr
      FROM search_term_view
      WHERE segments.date DURING ${dateRange}
    `
    if (campaignId) query += ` AND campaign.id = ${campaignId}`
    if (adGroupId) query += ` AND ad_group.id = ${adGroupId}`
    if (minImpressions > 0) query += ` AND metrics.impressions >= ${minImpressions}`
    query += ' ORDER BY metrics.cost_micros DESC'

    const rows = await customer.query(query)
    return rows.map(({ search_term_view, segments, campaign, ad_group, metrics }) => ({
      search_term: search_term_view?.search_term || '',
      keyword_text: segments?.keyword?.info?.text || '',
      match_type: String(segments?.keyword?.info?.match_type || ''),
      campaign_id: String(campaign?.id || ''),
      campaign_name: campaign?.name || '',
      ad_group_id: String(ad_group?.id || ''),
      ad_group_name: ad_group?.name || '',
      impressions: parseInt(metrics?.impressions || 0),
      clicks: parseInt(metrics?.clicks || 0),
      cost: parseFloat(((metrics?.cost_micros || 0) / 1_000_000).toFixed(2)),
      conversions: parseFloat(metrics?.conversions || 0),
      ctr: parseFloat(metrics?.ctr || 0),
    }))
  }

  // Account-level performance summary
  async getAccountSummary({ dateRange = 'LAST_30_DAYS' } = {}) {
    const customerId = this.account?.data?.customer_id
    if (!customerId) throw new Error('No Google Ads customer_id associated with this account')
    const customer = this._customer(customerId)

    const rows = await customer.query(`
      SELECT
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value
      FROM customer
      WHERE segments.date DURING ${dateRange}
    `)

    let totalImpressions = 0, totalClicks = 0, totalCostMicros = 0, totalConversions = 0
    for (const { metrics } of rows) {
      totalImpressions += parseInt(metrics?.impressions || 0)
      totalClicks += parseInt(metrics?.clicks || 0)
      totalCostMicros += parseInt(metrics?.cost_micros || 0)
      totalConversions += parseFloat(metrics?.conversions || 0)
    }

    const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions * 100) : 0
    const avgCpc = totalClicks > 0 ? (totalCostMicros / totalClicks) : 0
    const costPerConv = totalConversions > 0 ? (totalCostMicros / totalConversions) : 0

    return {
      customer_id: customerId,
      date_range: dateRange,
      total_impressions: totalImpressions,
      total_clicks: totalClicks,
      total_cost: parseFloat((totalCostMicros / 1_000_000).toFixed(2)),
      total_conversions: totalConversions,
      average_ctr: parseFloat(avgCtr.toFixed(2)),
      average_cpc: parseFloat((avgCpc / 1_000_000).toFixed(4)),
      cost_per_conversion: parseFloat((costPerConv / 1_000_000).toFixed(2)),
    }
  }

  // Google Ads API does not support post publishing
  async publishPost() {
    throw new Error('Google Ads accounts cannot publish social posts')
  }

  // ── GAQL preprocessing (ported from aidvertaiser) ─────────────────────────

  _preprocessGaql(query) {
    // Fix OR conditions on same field → IN (...)
    query = query.replace(
      /(\b[\w.]+)\s*=\s*'([^']+)'(?:\s+OR\s+\1\s*=\s*'([^']+)')+/gi,
      (match, field) => {
        const values = [...match.matchAll(new RegExp(`${field.replace(/\./g, '\\.')}\\s*=\\s*'([^']+)'`, 'gi'))].map(m => m[1])
        return `${field} IN (${values.map(v => `'${v}'`).join(', ')})`
      }
    )
    // Strip outer WHERE parentheses around AND conditions
    query = query.replace(/\(\s*((?:(?!\bIN\b).)*?\bAND\b.*?)\s*\)/gi, (match, inner) => {
      if (/\bAND\b/i.test(inner) && !inner.trim().startsWith("'")) return inner
      return match
    })
    // Add omit_unselected_resource_names if not present
    if (!query.toLowerCase().includes('omit_unselected_resource_names')) {
      query = query.toUpperCase().includes('PARAMETERS')
        ? query + ', omit_unselected_resource_names=true'
        : query + ' PARAMETERS omit_unselected_resource_names=true'
    }
    return query
  }

  // Convert a GAQL row (which may contain nested objects) to a plain object
  _rowToPlain(row) {
    if (row === null || typeof row !== 'object') return row
    const out = {}
    for (const [k, v] of Object.entries(row)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        out[k] = this._rowToPlain(v)
      } else {
        out[k] = v
      }
    }
    return out
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  _mapStatus(status) {
    // SDK may return string or enum int depending on version
    if (typeof status === 'number') {
      return { 2: 'active', 3: 'paused', 4: 'ended' }[status] || 'draft'
    }
    return { ENABLED: 'active', PAUSED: 'paused', REMOVED: 'ended' }[status] || 'draft'
  }

  _mapChannelType(type) {
    if (typeof type === 'number') {
      return { 2: 'search', 3: 'display', 5: 'video', 6: 'shopping', 8: 'performance_max' }[type] || 'search'
    }
    return {
      SEARCH: 'search', DISPLAY: 'display', SHOPPING: 'shopping',
      VIDEO: 'video', SMART: 'smart', PERFORMANCE_MAX: 'performance_max',
    }[type] || 'search'
  }

  hasEntities() { return false }
  getCharLimit() { return 0 }
  getMediaLimit() { return { photos: 0, videos: 0, gifs: 0, mixed: false } }
}
