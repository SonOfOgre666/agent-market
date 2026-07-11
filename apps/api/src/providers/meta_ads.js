/**
 * Meta Marketing API (dedicated Meta Ads connect / ad accounts).
 *
 * OAuth + account picker only (this file). All Graph execution — campaigns, ad sets, ads,
 * insights — runs in the worker via ``tasks.ads.execute_ads_tool`` and registry tools
 * (``meta_list_campaigns``, ``meta_list_adsets``, ``meta_create_campaign``, etc.).
 */
import axios from 'axios'

const GRAPH = 'https://graph.facebook.com'

const SCOPES = [
  'ads_management',
  'ads_read',
  'business_management',
  'pages_show_list',
  'read_insights',
].join(',')

function adAccountStatusLabel(status) {
  const n = Number(status)
  if (n === 1) return 'Active'
  if (n === 2) return 'Disabled'
  if (n === 3) return 'Unsettled'
  if (n === 7) return 'Pending risk review'
  if (n === 9) return 'Pending settlement'
  if (n === 100) return 'Pending closure'
  if (n === 101) return 'Closed'
  return `Status ${status}`
}

export class MetaAdsProvider {
  constructor(config = {}, account = null) {
    this.config = config
    this.account = account
    this.appId = config.app_id
    this.appSecret = config.app_secret
    this.apiVersion = config.api_version || 'v22.0'
    this.base = `${GRAPH}/${this.apiVersion}`
    const apiBase = process.env.API_URL || 'http://localhost:4010'
    this.callbackUrl =
      process.env.META_CALLBACK_URL_META_ADS || `${apiBase}/callback/meta_ads`
  }

  _token() {
    const t =
      this.account?.access_token?.token ||
      this.account?.data?.user_token
    if (!t) throw new Error('Not authorized — reconnect Meta Ads')
    return t
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
    let tokenRes
    try {
      tokenRes = await axios.post(`${this.base}/oauth/access_token`, null, {
        params: {
          client_id: this.appId,
          client_secret: this.appSecret,
          redirect_uri: this.callbackUrl,
          code,
        },
      })
    } catch (err) {
      const fb = err.response?.data?.error
      throw new Error(fb ? `Facebook: ${fb.message}` : err.message)
    }
    const { access_token } = tokenRes.data

    const longTokenRes = await axios.get(`${this.base}/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: this.appId,
        client_secret: this.appSecret,
        fb_exchange_token: access_token,
      },
    })
    const longToken = longTokenRes.data.access_token

    const meRes = await axios.get(`${this.base}/me`, {
      params: { access_token: longToken, fields: 'id,name,picture' },
    })
    const me = meRes.data

    return {
      provider: 'meta_ads',
      provider_id: me.id,
      name: me.name,
      username: me.id,
      media: { avatar: me.picture?.data?.url },
      data: { user_token: longToken, user_id: me.id },
      access_token: { token: longToken },
      authorized: true,
    }
  }

  hasEntities() {
    return true
  }

  async getEntities() {
    const token = this._token()
    const res = await axios.get(`${this.base}/me/adaccounts`, {
      params: {
        access_token: token,
        fields: 'id,name,account_id,currency,account_status',
        limit: 500,
      },
    })
    const rows = res.data.data || []
    return rows.map((a) => ({
      type: 'meta_ads',
      id: a.id,
      name: a.name || a.account_id,
      currency: a.currency,
      user_token: token,
      account_status: a.account_status,
    }))
  }

  async saveEntity(entity, user_id, workspace_id) {
    const { upsertAccount } = await import('../models/Account.js')
    const actId = entity.id.startsWith('act_') ? entity.id : `act_${entity.id}`
    return upsertAccount({
      workspace_id: workspace_id || null,
      provider: 'meta_ads',
      provider_id: actId.replace(/^act_/, ''),
      name: entity.name,
      username: actId,
      media: {},
      data: {
        ad_account_id: actId,
        user_token: entity.user_token,
        user_id,
      },
      access_token: { token: entity.user_token },
      authorized: true,
    })
  }

  async saveEntities(entities, user_id, workspace_id) {
    const out = []
    for (const e of entities) {
      out.push(await this.saveEntity(e, user_id, workspace_id))
    }
    return out
  }

  /** @deprecated Use worker tool ``meta_get_ad_accounts`` (``GET /api/ads/meta/ad-accounts``). */
  async getAdAccounts() {
    const token = this._token()
    const res = await axios.get(`${this.base}/me/adaccounts`, {
      params: {
        access_token: token,
        fields: 'id,name,account_id,currency,account_status',
        limit: 500,
      },
    })
    return (res.data.data || []).map((a) => ({
      id: a.id,
      name: a.name,
      currency: a.currency,
      status_label: adAccountStatusLabel(a.account_status),
    }))
  }

  async getAccount() {
    const token = this._token()
    const actId =
      this.account?.data?.ad_account_id ||
      (this.account?.provider_id
        ? `act_${String(this.account.provider_id).replace(/^act_/, '')}`
        : null)
    if (!actId) {
      return {
        name: this.account?.name,
        username: this.account?.username,
        data: this.account?.data,
      }
    }
    const res = await axios.get(`${this.base}/${actId}`, {
      params: { access_token: token, fields: 'id,name,currency,account_status' },
    })
    const d = res.data
    return {
      name: d.name,
      username: d.id,
      data: {
        ...(this.account?.data || {}),
        ad_account_id: d.id,
      },
    }
  }

}
