import { getRedis } from '../db/redis.js'
import { getDb } from '../db/mongodb.js'
import { nanoid } from 'nanoid'
import * as Account from '../models/Account.js'
import { getSocialProvider } from '../providers/index.js'

const SUPPORTED_PROVIDERS = ['linkedin', 'instagram', 'tiktok', 'google-ads']

const PROVIDER_META = {
  linkedin: {
    name: 'LinkedIn',
    scopes: ['r_liteprofile', 'r_emailaddress', 'w_member_social'],
    authType: 'oauth2',
  },
  instagram: {
    name: 'Instagram',
    scopes: ['instagram_basic', 'instagram_content_publish'],
    authType: 'oauth2',
  },
  tiktok: {
    name: 'TikTok',
    scopes: ['user.info.basic', 'video.list'],
    authType: 'oauth2',
  },
  'google-ads': {
    name: 'Google Ads',
    scopes: ['https://www.googleapis.com/auth/adwords'],
    authType: 'oauth2',
  },
}

// Build OAuth connect URL per provider
async function buildConnectUrl(provider, userId) {
  const state = nanoid()
  const redis = getRedis()
  await redis.setex(`oauth_state:${state}`, 600, JSON.stringify({ userId }))

  if (provider === 'linkedin') {
    const clientId = process.env.LINKEDIN_CLIENT_ID
    const callbackUrl = process.env.LINKEDIN_CALLBACK_URL
      || `http://localhost:4010/api/integrations/linkedin/callback`
    if (!clientId) return null
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: callbackUrl,
      state,
      scope: 'r_liteprofile r_emailaddress w_member_social',
    })
    return `https://www.linkedin.com/oauth/v2/authorization?${params}`
  }

  if (provider === 'instagram') {
    const clientId = process.env.INSTAGRAM_CLIENT_ID
    const callbackUrl = process.env.INSTAGRAM_CALLBACK_URL
      || `http://localhost:4010/api/integrations/instagram/callback`
    if (!clientId) return null
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl,
      scope: 'instagram_basic,instagram_content_publish',
      response_type: 'code',
      state,
    })
    return `https://api.instagram.com/oauth/authorize?${params}`
  }

  if (provider === 'tiktok') {
    const clientKey = process.env.TIKTOK_CLIENT_KEY
    const callbackUrl = process.env.TIKTOK_CALLBACK_URL
      || `http://localhost:4010/api/integrations/tiktok/callback`
    if (!clientKey) return null
    const params = new URLSearchParams({
      client_key: clientKey,
      redirect_uri: callbackUrl,
      scope: 'user.info.basic,video.list',
      response_type: 'code',
      state,
    })
    return `https://www.tiktok.com/auth/authorize/?${params}`
  }

  if (provider === 'google-ads') {
    const clientId = process.env.GOOGLE_ADS_CLIENT_ID
    const callbackUrl = process.env.GOOGLE_ADS_CALLBACK_URL
      || `http://localhost:4010/api/integrations/google-ads/callback`
    if (!clientId) return null
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl,
      scope: 'https://www.googleapis.com/auth/adwords',
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      state,
    })
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  }

  return null
}

export default async function integrationsRoutes(app) {

  // GET /api/integrations/providers
  app.get('/integrations/providers', async (_request, reply) => {
    return reply.send({
      providers: SUPPORTED_PROVIDERS.map(id => ({
        id,
        ...PROVIDER_META[id],
        connectUrl: `/api/integrations/${id}/connect`,
        statusUrl: `/api/integrations/${id}/status`,
      })),
    })
  })

  // GET /api/integrations/:provider/connect?userId=wetaxi
  app.get('/integrations/:provider/connect', async (request, reply) => {
    const { provider } = request.params
    const { userId } = request.query
    if (!userId) return reply.code(422).send({ error: 'userId query param is required' })
    if (!SUPPORTED_PROVIDERS.includes(provider)) {
      return reply.code(404).send({ error: `Unknown provider: ${provider}` })
    }

    const authUrl = await buildConnectUrl(provider, userId)
    if (!authUrl) {
      return reply.code(422).send({
        error: `Provider ${provider} credentials not configured. Set the required env vars.`,
        provider,
        configured: false,
      })
    }

    return reply.send({ provider, authUrl, message: 'Open authUrl in a browser to authorize' })
  })

  // GET /api/integrations/:provider/status?userId=wetaxi
  app.get('/integrations/:provider/status', async (request, reply) => {
    const { provider } = request.params
    const { userId } = request.query
    if (!userId) return reply.code(422).send({ error: 'userId query param is required' })
    if (!SUPPORTED_PROVIDERS.includes(provider)) {
      return reply.code(404).send({ error: `Unknown provider: ${provider}` })
    }

    const db = getDb()
    const token = await db.collection('integration_tokens').findOne({ userId, provider })

    if (!token) {
      return reply.send({ provider, userId, connected: false, status: 'not_connected' })
    }

    const expired = token.expiresAt && new Date(token.expiresAt) < new Date()
    return reply.send({
      provider,
      userId,
      connected: !expired,
      status: expired ? 'token_expired' : 'connected',
      name: token.name || null,
      connectedAt: token.createdAt,
      expiresAt: token.expiresAt || null,
    })
  })

  // GET /api/integrations/diagnostics?userId=wetaxi
  app.get('/integrations/diagnostics', async (request, reply) => {
    const { userId } = request.query
    if (!userId) return reply.code(422).send({ error: 'userId query param is required' })

    const db = getDb()
    const tokens = await db.collection('integration_tokens').find({ userId }).toArray()

    const diagnostics = {}
    for (const provider of SUPPORTED_PROVIDERS) {
      const token = tokens.find(t => t.provider === provider)
      const envConfigured = checkProviderEnv(provider)
      diagnostics[provider] = {
        envConfigured,
        connected: !!token,
        tokenExpired: token?.expiresAt ? new Date(token.expiresAt) < new Date() : false,
        name: token?.name || null,
        mode: !envConfigured ? 'dry_run' : (token ? 'live' : 'not_connected'),
      }
    }

    return reply.send({ userId, diagnostics })
  })

  // GET /api/integrations/google-ads/refresh-token?userId=wetaxi
  app.get('/integrations/google-ads/refresh-token', async (request, reply) => {
    const { userId } = request.query
    if (!userId) return reply.code(422).send({ error: 'userId query param is required' })

    const db = getDb()
    const token = await db.collection('integration_tokens').findOne({ userId, provider: 'google-ads' })
    if (!token?.refreshToken) {
      return reply.code(404).send({ error: 'No Google Ads refresh token found. Connect via /api/integrations/google-ads/connect first.' })
    }

    try {
      const clientId = process.env.GOOGLE_ADS_CLIENT_ID
      const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET
      if (!clientId || !clientSecret) {
        return reply.code(422).send({ error: 'Google Ads credentials not configured' })
      }

      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: token.refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      })
      const data = await res.json()
      if (!res.ok) return reply.code(502).send({ error: 'Failed to refresh token', detail: data })

      const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000)
      await db.collection('integration_tokens').updateOne(
        { userId, provider: 'google-ads' },
        { $set: { accessToken: data.access_token, expiresAt, updatedAt: new Date() } }
      )

      return reply.send({ refreshed: true, expiresAt })
    } catch (err) {
      app.log.error(err)
      return reply.code(500).send({ error: err.message })
    }
  })

  // ─── OAuth Callbacks ─────────────────────────────────────────────────────

  // GET /api/integrations/linkedin/callback
  app.get('/integrations/linkedin/callback', async (request, reply) => {
    return handleOAuthCallback(app, request, reply, 'linkedin')
  })

  // GET /api/integrations/instagram/callback
  app.get('/integrations/instagram/callback', async (request, reply) => {
    return handleOAuthCallback(app, request, reply, 'instagram')
  })

  // GET /api/integrations/tiktok/callback
  app.get('/integrations/tiktok/callback', async (request, reply) => {
    return handleOAuthCallback(app, request, reply, 'tiktok')
  })

  // GET /api/integrations/google-ads/callback
  app.get('/integrations/google-ads/callback', async (request, reply) => {
    return handleOAuthCallback(app, request, reply, 'google-ads')
  })

  // GET /api/integrations/twitter/callback
  app.get('/integrations/twitter/callback', async (request, reply) => {
    return handleOAuthCallback(app, request, reply, 'twitter')
  })

  // GET /api/integrations/facebook_page/callback
  app.get('/integrations/facebook_page/callback', async (request, reply) => {
    return handleOAuthCallback(app, request, reply, 'facebook_page')
  })

  // GET /api/integrations/instagram_login/callback
  app.get('/integrations/instagram_login/callback', async (request, reply) => {
    return handleOAuthCallback(app, request, reply, 'instagram_login')
  })
}

function checkProviderEnv(provider) {
  if (provider === 'linkedin') return !!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET)
  if (provider === 'instagram') return !!(process.env.INSTAGRAM_CLIENT_ID && process.env.INSTAGRAM_CLIENT_SECRET)
  if (provider === 'tiktok') return !!(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET)
  if (provider === 'google-ads') return !!(process.env.GOOGLE_ADS_CLIENT_ID && process.env.GOOGLE_ADS_CLIENT_SECRET)
  return false
}

async function handleOAuthCallback(app, request, reply, provider) {
  const WEB_URL = process.env.NEXT_PUBLIC_WEB_URL || 'http://localhost:3000'
  const { code, state, error } = request.query

  let statePayload = null
  if (state) {
    const raw = await getRedis().get(`oauth_state:${state}`)
    if (raw) {
      await getRedis().del(`oauth_state:${state}`)
      try { statePayload = JSON.parse(raw) } catch { statePayload = { userId: raw } }
    }
  }

  const userId = statePayload?.userId || null
  const workspaceId = statePayload?.workspaceId || null
  const forceAccountFlow = ['twitter', 'facebook_page', 'instagram_login'].includes(provider)
  const isAccountsFlow = forceAccountFlow || !!workspaceId

  if (error) {
    const target = isAccountsFlow ? 'accounts' : 'settings'
    return reply.redirect(`${WEB_URL}/${target}?provider=${provider}&error=${encodeURIComponent(error)}`)
  }

  try {
    if (isAccountsFlow) {
      return handleAccountsOAuthCallback(app, request, reply, provider, userId, workspaceId, WEB_URL)
    }

    const tokenData = await exchangeCodeForToken(provider, code)
    const db = getDb()
    await db.collection('integration_tokens').updateOne(
      { userId, provider },
      {
        $set: {
          userId,
          provider,
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token || null,
          expiresAt: tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : null,
          name: tokenData.name || null,
          raw: tokenData,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    )

    const eventsChannel = process.env.EVENTS_CHANNEL || 'agent_market:events'
    getRedis().publish(eventsChannel, JSON.stringify({ event: 'integration.connected', provider, userId }))

    return reply.redirect(`${WEB_URL}/settings?provider=${provider}&connected=1`)
  } catch (err) {
    app.log.error(err)
    const target = isAccountsFlow ? 'accounts' : 'settings'
    return reply.redirect(`${WEB_URL}/${target}?provider=${provider}&error=${encodeURIComponent(err.message)}`)
  }
}

function mapToAccountProvider(provider) {
  if (provider === 'google-ads') return 'google_ads'
  return provider
}

async function handleAccountsOAuthCallback(app, request, reply, provider, userId, workspaceId, WEB_URL) {
  const accountProvider = mapToAccountProvider(provider)
  const query = request.query

  try {
    const providerInstance = await getSocialProvider(accountProvider, { workspace_id: workspaceId })
    const accountData = await providerInstance.handleCallback(query)

    if (typeof providerInstance.hasEntities === 'function' && providerInstance.hasEntities()) {
      const key = nanoid()
      await getRedis().set(
        `oauth_parent:${key}`,
        JSON.stringify({ accountData, userId, workspaceId }),
        'EX', 600
      )
      return reply.redirect(`${WEB_URL}/accounts/entities?provider=${accountProvider}&parent_key=${key}`)
    }

    const saved = await Account.upsertAccount({
      ...accountData,
      workspace_id: workspaceId || null,
    })
    getRedis().publish('agentmarket:account_added', JSON.stringify({ account_id: saved._id.toString() }))

    return reply.redirect(`${WEB_URL}/accounts?connected=1`)
  } catch (err) {
    app.log.error(err)
    return reply.redirect(`${WEB_URL}/accounts?error=${encodeURIComponent(err.message)}`)
  }
}

async function exchangeCodeForToken(provider, code) {
  if (provider === 'linkedin') {
    const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.LINKEDIN_CALLBACK_URL || 'http://localhost:4010/api/integrations/linkedin/callback',
        client_id: process.env.LINKEDIN_CLIENT_ID || '',
        client_secret: process.env.LINKEDIN_CLIENT_SECRET || '',
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error_description || 'LinkedIn token exchange failed')
    return data
  }

  if (provider === 'instagram') {
    const res = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.INSTAGRAM_CLIENT_ID || '',
        client_secret: process.env.INSTAGRAM_CLIENT_SECRET || '',
        grant_type: 'authorization_code',
        redirect_uri: process.env.INSTAGRAM_CALLBACK_URL || 'http://localhost:4010/api/integrations/instagram/callback',
        code,
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error_message || 'Instagram token exchange failed')
    return data
  }

  if (provider === 'tiktok') {
    const res = await fetch('https://open-api.tiktok.com/oauth/access_token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY || '',
        client_secret: process.env.TIKTOK_CLIENT_SECRET || '',
        grant_type: 'authorization_code',
        redirect_uri: process.env.TIKTOK_CALLBACK_URL || 'http://localhost:4010/api/integrations/tiktok/callback',
        code,
      }),
    })
    const data = await res.json()
    if (data.data?.error_code) throw new Error(data.data.description || 'TikTok token exchange failed')
    return data.data || data
  }

  if (provider === 'google-ads') {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_ADS_CLIENT_ID || '',
        client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET || '',
        redirect_uri: process.env.GOOGLE_ADS_CALLBACK_URL || 'http://localhost:4010/api/integrations/google-ads/callback',
        grant_type: 'authorization_code',
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error_description || 'Google Ads token exchange failed')
    return data
  }

  throw new Error(`Unsupported provider: ${provider}`)
}
