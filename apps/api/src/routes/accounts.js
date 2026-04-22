import { authenticate } from '../middleware/auth.js'
import * as Account from '../models/Account.js'
import { getSocialProvider } from '../providers/index.js'
import { getRedis } from '../db/redis.js'
import { nanoid } from 'nanoid'

export default async function accountRoutes(app) {
  // GET /api/accounts
  app.get('/accounts', { preHandler: [authenticate] }, async (request, reply) => {
    const accounts = await Account.findAll(request.workspace_id)
    return reply.send(accounts.map(Account.serialize))
  })

  // POST /api/accounts/add/:provider  — initiate OAuth
  // Store workspace_id + user_id in Redis keyed by a state token so the callback can retrieve it
  app.post('/accounts/add/:provider', { preHandler: [authenticate] }, async (request, reply) => {
    const { provider } = request.params
    const body = request.body || {}
    try {
      const providerInstance = await getSocialProvider(provider, { ...body, workspace_id: request.workspace_id })
      const authUrl = await providerInstance.getAuthUrl()

      // Persist workspace_id for the duration of the OAuth round-trip (10 min TTL)
      const state = nanoid()
      await getRedis().set(`oauth_state:${state}`, JSON.stringify({ userId: request.user.id, workspaceId: request.workspace_id }), 'EX', 600)

      // Append state to auth URL
      const separator = authUrl.includes('?') ? '&' : '?'
      return reply.send({ auth_url: `${authUrl}${separator}state=${state}` })
    } catch (err) {
      return reply.code(400).send({ error: err.message })
    }
  })

  // PUT /api/accounts/:id  — refresh account data
  app.put('/accounts/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const account = await Account.findByUuid(request.params.id) || await Account.findById(request.params.id)
    if (!account) return reply.code(404).send({ error: 'Account not found' })
    // Ownership check
    if (account.workspace_id && account.workspace_id !== request.workspace_id) return reply.code(403).send({ error: 'Forbidden' })

    try {
      const provider = await getSocialProvider(account.provider, {}, account)
      const freshData = await provider.getAccount()
      const updated = await Account.updateAccount(account._id.toString(), {
        name: freshData.name,
        username: freshData.username,
        media: freshData.media || account.media,
        data: freshData.data || account.data,
        authorized: true,
      })
      return reply.send(Account.serialize(updated))
    } catch (err) {
      return reply.code(400).send({ error: err.message })
    }
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

  // POST /api/accounts/entities/:provider  — save selected entity
  app.post('/accounts/entities/:provider', { preHandler: [authenticate] }, async (request, reply) => {
    const { provider } = request.params
    const { entity, parent_key } = request.body || {}
    if (!entity) return reply.code(422).send({ error: 'Entity is required' })
    if (!parent_key) return reply.code(422).send({ error: 'parent_key is required' })

    const raw = await getRedis().get(`oauth_parent:${parent_key}`)
    if (!raw) return reply.code(410).send({ error: 'Session expired — please reconnect your account' })

    try {
      const { userId, workspaceId } = JSON.parse(raw)
      // Delete the Redis key — one-time use
      await getRedis().del(`oauth_parent:${parent_key}`)

      const providerInstance = await getSocialProvider(provider, { workspace_id: workspaceId || request.workspace_id })
      const saved = await providerInstance.saveEntity(entity, userId || request.user.id, workspaceId || request.workspace_id)
      getRedis().publish('agentmarket:account_added', JSON.stringify({ account_id: saved._id.toString() }))
      return reply.code(201).send(Account.serialize(saved))
    } catch (err) {
      return reply.code(400).send({ error: err.message })
    }
  })
}
