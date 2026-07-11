import * as Account from '../models/Account.js'
import { getDecryptedConfig } from '../models/Integration.js'

async function mergeGoogleAdsService(workspaceId) {
  let cfg = await getDecryptedConfig('google_ads', workspaceId)
  if (!cfg || !Object.keys(cfg).length) {
    cfg = await getDecryptedConfig('google_ads')
  }
  cfg = { ...(cfg || {}) }
  if (!cfg.developer_token && process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
    cfg.developer_token = process.env.GOOGLE_ADS_DEVELOPER_TOKEN
  }
  if (!cfg.client_id && process.env.GOOGLE_ADS_CLIENT_ID) cfg.client_id = process.env.GOOGLE_ADS_CLIENT_ID
  if (!cfg.client_secret && process.env.GOOGLE_ADS_CLIENT_SECRET) {
    cfg.client_secret = process.env.GOOGLE_ADS_CLIENT_SECRET
  }
  return cfg
}

/**
 * Inject platform credentials for ads tool execution (API boundary).
 * Worker may also enrich via worker_api when only account_id is sent.
 */
export async function enrichAdsToolPayload(workspaceId, toolId, payload = {}) {
  const body = { ...(payload || {}) }
  const accountId = body.account_id
  if (!accountId) return body

  const account = (await Account.findByUuid(accountId)) || (await Account.findById(accountId))
  if (!account) {
    const e = new Error('Account not found')
    e.statusCode = 404
    throw e
  }
  if (workspaceId && account.workspace_id && account.workspace_id !== workspaceId) {
    const e = new Error('Forbidden')
    e.statusCode = 403
    throw e
  }
  if (!account.authorized) {
    const e = new Error('Account is not authorized')
    e.statusCode = 422
    throw e
  }

  const tid = String(toolId || '')

  if (tid.startsWith('meta_')) {
    if (!body.access_token) {
      const token = account.access_token?.token || account.data?.user_token
      if (!token) {
        const e = new Error('No Meta token on account')
        e.statusCode = 422
        throw e
      }
      body.access_token = token
    }
    if (!body.ad_account_id && account.data?.ad_account_id) {
      body.ad_account_id = account.data.ad_account_id
    }
    if (!body.api_version) {
      const fb = await getDecryptedConfig('facebook', workspaceId)
      body.api_version = fb?.api_version || 'v22.0'
    }
  }

  if (tid.startsWith('google_')) {
    const gsvc = await mergeGoogleAdsService(workspaceId)
    const refresh = account.access_token?.refresh_token
    if (!body.google_ads_client_config && refresh && gsvc.developer_token) {
      body.google_ads_client_config = {
        developer_token: gsvc.developer_token,
        client_id: gsvc.client_id,
        client_secret: gsvc.client_secret,
        refresh_token: refresh,
        use_proto_plus: true,
      }
      const loginCid = account.data?.login_customer_id || process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
      const loginDigits = loginCid ? String(loginCid).replace(/\D/g, '') : ''
      const customerDigits = account.data?.customer_id
        ? String(account.data.customer_id).replace(/\D/g, '')
        : ''
      if (loginDigits && loginDigits !== customerDigits) {
        body.google_ads_client_config.login_customer_id = loginDigits
      }
    }
    if (!body.customer_id && account.data?.customer_id) {
      body.customer_id = String(account.data.customer_id).replace(/\D/g, '')
    }
  }

  return body
}
