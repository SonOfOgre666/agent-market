import { authenticate } from '../middleware/auth.js'
import * as Account from '../models/Account.js'
import { getSocialProvider } from '../providers/index.js'
import { getRedis } from '../lib/redis.js'
import { publishEvent } from '../lib/events.js'
import { nanoid } from 'nanoid'
import { dispatchImportAccount } from '../queue/dispatcher.js'
import { enqueueCeleryAndWaitForJson } from '../lib/p2ExecCeleryReply.js'

export default async function accountRoutes(app) {
  // GET /api/accounts?kind=social|ads  (default: all — prefer kind for UI)
  app.get('/accounts', { preHandler: [authenticate] }, async (request, reply) => {
    const kind = request.query.kind === 'social' || request.query.kind === 'ads' ? request.query.kind : null
    const accounts = await Account.findAll(request.workspace_id, { kind })
    return reply.send(accounts.map(Account.serialize))
  })

  // POST /api/accounts/add/:provider  — initiate OAuth
  // Store workspace_id + user_id in Redis keyed by a state token so the callback can retrieve it
  app.post('/accounts/add/:provider', { preHandler: [authenticate] }, async (request, reply) => {
    const { provider } = request.params
    const body = request.body || {}
    const kind = body.kind || request.query.kind
    if (kind === 'social' && !Account.isSocialProvider(provider) && provider !== 'facebook_page') {
      return reply.code(400).send({ error: 'Use Ads accounts to connect Google Ads or Meta Ads' })
    }
    if (kind === 'ads' && !Account.isAdsProvider(provider)) {
      return reply.code(400).send({ error: 'Ads connections must be google_ads or meta_ads' })
    }
    try {
      const providerInstance = await getSocialProvider(provider, { ...body, workspace_id: request.workspace_id })
      const oauthContext = {
        workspaceId: request.workspace_id,
        userId: request.user.id,
        return_to: '/accounts',
      }
      const authUrl = provider === 'twitter'
        ? await providerInstance.getAuthUrl(oauthContext)
        : await providerInstance.getAuthUrl()

      // Persist workspace_id for the duration of the OAuth round-trip (10 min TTL)
      const state = nanoid()
      const return_to = '/accounts'
      await getRedis().set(
        `oauth_state:${state}`,
        JSON.stringify({ userId: request.user.id, workspaceId: request.workspace_id, return_to }),
        'EX',
        600,
      )

      // Replace any provider state with our workspace-scoped OAuth state.
      const url = new URL(authUrl)
      if (provider === 'tiktok') {
        const providerState = url.searchParams.get('state')
        if (providerState) {
          const redis = getRedis()
          const verifier = await redis.get(`tiktok:pkce:${providerState}`)
          if (verifier) {
            await redis.del(`tiktok:pkce:${providerState}`)
            await redis.setex(`tiktok:pkce:${state}`, 600, verifier)
          }
        }
      }
      url.searchParams.set('state', state)
      return reply.send({ auth_url: url.toString() })
    } catch (err) {
      return reply.code(400).send({ error: err.message })
    }
  })

  // PATCH /api/accounts/:id/google-customer — set Ads customer id after OAuth (Meta-style picker)
  app.patch('/accounts/:id/google-customer', { preHandler: [authenticate] }, async (request, reply) => {
    const account = await Account.findByUuid(request.params.id) || await Account.findById(request.params.id)
    if (!account) return reply.code(404).send({ error: 'Account not found' })
    if (account.workspace_id && account.workspace_id !== request.workspace_id) {
      return reply.code(403).send({ error: 'Forbidden' })
    }
    if (account.provider !== 'google_ads') {
      return reply.code(422).send({ error: 'Account is not a Google Ads connection' })
    }
    const customerId = String(request.body?.customer_id || '').replace(/\D/g, '')
    if (!customerId) return reply.code(422).send({ error: 'customer_id is required' })

    let loginCustomerId = request.body?.login_customer_id != null
      ? String(request.body.login_customer_id).replace(/\D/g, '') || null
      : null
    let displayName = request.body?.name || null
    let accountTypeLabel = request.body?.account_type_label || null

    if (!loginCustomerId || !displayName) {
      try {
        const { GoogleAdsProvider } = await import('../providers/google_ads.js')
        const { getDecryptedConfig } = await import('../models/Integration.js')
        const config = await getDecryptedConfig('google_ads', request.workspace_id)
        const provider = new GoogleAdsProvider(config, account)
        const entities = await provider.getEntities()
        const match = entities.find((e) => String(e.customer_id) === customerId)
        if (match) {
          if (!loginCustomerId && match.login_customer_id) {
            loginCustomerId = String(match.login_customer_id).replace(/\D/g, '') || null
          }
          if (!displayName) displayName = match.name
          if (!accountTypeLabel) accountTypeLabel = match.account_type_label
        }
      } catch {
        /* keep request body values */
      }
    }
    if (loginCustomerId === customerId) loginCustomerId = null

    const updated = await Account.updateAccount(account._id.toString(), {
      name: displayName || account.name,
      data: {
        ...(account.data || {}),
        customer_id: customerId,
        login_customer_id: loginCustomerId,
        ...(accountTypeLabel ? { account_type_label: accountTypeLabel } : {}),
      },
      pending_entities: false,
      authorized: true,
    })
    return reply.send(Account.serialize(updated))
  })

  // PUT /api/accounts/:id  — refresh account data
  app.put('/accounts/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const account = await Account.findByUuid(request.params.id) || await Account.findById(request.params.id)
    if (!account) return reply.code(404).send({ error: 'Account not found' })
    // Ownership check
    if (account.workspace_id && account.workspace_id !== request.workspace_id) return reply.code(403).send({ error: 'Forbidden' })

    try {
      const json = await enqueueCeleryAndWaitForJson(
        'tasks.social.refresh_account_profile',
        [String(account._id), String(request.workspace_id)],
        { timeoutMs: 90000 },
      )
      if (!json.ok) {
        return reply
          .code(Number(json.status) || 502)
          .send({ error: json.error || 'Worker could not refresh profile' })
      }
      const snap = json.data || {}
      const updated = await Account.updateAccount(account._id.toString(), {
        name: snap.name,
        username: snap.username,
        media: snap.media || account.media,
        data: { ...(account.data || {}), ...(snap.data || {}) },
        authorized: true,
      })
      return reply.send(Account.serialize(updated))
    } catch (err) {
      return reply.code(400).send({ error: err.message })
    }
  })

  // POST /api/accounts/:id/queue-imports — enqueue audience/posts/metrics imports (same as account-added listener)
  app.post('/accounts/:id/queue-imports', { preHandler: [authenticate] }, async (request, reply) => {
    const account = await Account.findByUuid(request.params.id) || await Account.findById(request.params.id)
    if (!account) return reply.code(404).send({ error: 'Account not found' })
    if (account.workspace_id && account.workspace_id !== request.workspace_id) return reply.code(403).send({ error: 'Forbidden' })
    if (!account.authorized) return reply.code(422).send({ error: 'Account is not authorized' })

    const out = await dispatchImportAccount(account._id.toString())
    return reply.code(202).send({
      ok: true,
      mode: 'celery',
      bridge_task_id: out.task_id,
    })
  })

  // DELETE /api/accounts/:id
  app.delete('/accounts/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const account = await Account.findByUuid(request.params.id) || await Account.findById(request.params.id)
    if (!account) return reply.code(404).send({ error: 'Account not found' })
    if (account.workspace_id && account.workspace_id !== request.workspace_id) return reply.code(403).send({ error: 'Forbidden' })
    await Account.deleteAccount(account._id.toString())
    return reply.code(204).send()
  })

  // GET /api/accounts/entities/:provider  — get Facebook pages / Instagram accounts
  // parent_key is a Redis key holding the OAuth token (never stored in MongoDB)
  app.get('/accounts/entities/:provider', { preHandler: [authenticate] }, async (request, reply) => {
    const { provider } = request.params
    const { parent_key } = request.query
    if (!parent_key) return reply.code(422).send({ error: 'parent_key is required' })

    const raw = await getRedis().get(`oauth_parent:${parent_key}`)
    if (!raw) return reply.code(410).send({ error: 'Session expired — please reconnect your account' })

    try {
      const { accountData, workspaceId } = JSON.parse(raw)
      // Build a temporary account-like object with just the token so getEntities() can call the API
      const tempAccount = { provider: accountData.provider, access_token: accountData.access_token }
      const providerInstance = await getSocialProvider(provider, { workspace_id: workspaceId || request.workspace_id }, tempAccount)
      const entities = await providerInstance.getEntities()
      return reply.send(entities)
    } catch (err) {
      return reply.code(400).send({ error: err.message })
    }
  })

  // POST /api/accounts/entities/:provider  — save selected entity (or multiple entities)
  app.post('/accounts/entities/:provider', { preHandler: [authenticate] }, async (request, reply) => {
    const { provider } = request.params
    const { entity, entities, parent_key } = request.body || {}
    if (!entity && !entities) return reply.code(422).send({ error: 'Entity is required' })
    if (!parent_key) return reply.code(422).send({ error: 'parent_key is required' })

    const raw = await getRedis().get(`oauth_parent:${parent_key}`)
    if (!raw) return reply.code(410).send({ error: 'Session expired — please reconnect your account' })

    try {
      const { accountData, userId, workspaceId } = JSON.parse(raw)
      await getRedis().del(`oauth_parent:${parent_key}`)

      const tempAccount = accountData
        ? {
            provider: accountData.provider,
            provider_id: accountData.provider_id,
            name: accountData.name,
            username: accountData.username,
            media: accountData.media,
            data: accountData.data,
            access_token: accountData.access_token,
          }
        : null
      const providerInstance = await getSocialProvider(
        provider,
        { workspace_id: workspaceId || request.workspace_id },
        tempAccount,
      )

      // Multi-entity path (e.g. meta_ads — saves page + ad account together)
      if (entities && Array.isArray(entities)) {
        if (!entities.length) return reply.code(422).send({ error: 'entities array is empty' })
        const savedAll = await providerInstance.saveEntities(entities, userId || request.user.id, workspaceId || request.workspace_id)
        for (const s of savedAll) {
          getRedis().publish('agentmarket:account_added', JSON.stringify({ account_id: s._id.toString() }))
          await publishEvent('integration.connected', {
            provider,
            account_id: String(s._id),
          }).catch(() => {})
        }
        return reply.code(201).send(savedAll.map(Account.serialize))
      }

      const saved = await providerInstance.saveEntity(entity, userId || request.user.id, workspaceId || request.workspace_id)
      getRedis().publish('agentmarket:account_added', JSON.stringify({ account_id: saved._id.toString() }))
      await publishEvent('integration.connected', {
        provider,
        account_id: String(saved._id),
      }).catch(() => {})
      return reply.code(201).send(Account.serialize(saved))
    } catch (err) {
      return reply.code(400).send({ error: err.message })
    }
  })
}
