import * as Account from '../models/Account.js'
import { getSocialProvider } from '../providers/index.js'
import { getRedis } from '../db/redis.js'
import crypto from 'crypto'

const WEB_URL = process.env.NEXT_PUBLIC_WEB_URL || 'http://localhost:3000'

export default async function callbackRoutes(app) {
  // POST /data-deletion — Facebook data deletion callback
  app.post('/data-deletion', async (request, reply) => {
    try {
      const { signed_request } = request.body || {}
      if (!signed_request) return reply.code(400).send({ error: 'Missing signed_request' })

      const [encodedSig, payload] = signed_request.split('.')
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      const expectedSig = crypto
        .createHmac('sha256', process.env.META_APP_SECRET || '')
        .update(payload)
        .digest('base64url')

      if (encodedSig !== expectedSig) return reply.code(403).send({ error: 'Invalid signature' })

      const userId = data.user_id
      if (userId) {
        const db = (await import('../db/mongodb.js')).getDb()
        await db.collection('accounts').deleteMany({ 'data.user_id': userId })
      }

      const confirmationCode = crypto.randomBytes(8).toString('hex')
      return reply.send({
        url: `${process.env.NEXT_PUBLIC_API_URL || ''}/data-deletion/status?id=${confirmationCode}`,
        confirmation_code: confirmationCode,
      })
    } catch (err) {
      app.log.error(err)
      return reply.code(500).send({ error: 'Failed to process deletion request' })
    }
  })

  // GET /data-deletion/status — status page for deletion confirmation
  app.get('/data-deletion/status', async (_request, reply) => {
    return reply.send({ status: 'deleted', message: 'User data has been removed.' })
  })

  // GET /privacy — Privacy policy page (required by Meta)
  app.get('/privacy', async (_request, reply) => {
    return reply.type('text/html').send(`<!DOCTYPE html><html><head><title>Privacy Policy</title></head><body>
      <h1>Privacy Policy</h1>
      <p>This application connects your social media accounts to schedule and publish posts.</p>
      <p>We store only the access tokens and profile information necessary to post on your behalf.</p>
      <p>We do not sell or share your data with third parties.</p>
      <p>To request deletion of your data, contact: ${process.env.CONTACT_EMAIL || 'admin@agent-market.app'}</p>
    </body></html>`)
  })

  // GET /terms — Terms of service page (required by Meta)
  app.get('/terms', async (_request, reply) => {
    return reply.type('text/html').send(`<!DOCTYPE html><html><head><title>Terms of Service</title></head><body>
      <h1>Terms of Service</h1>
      <p>By using this application, you agree to use it only for lawful purposes.</p>
      <p>You are responsible for the content you publish through this application.</p>
      <p>We reserve the right to terminate access if these terms are violated.</p>
    </body></html>`)
  })

  // POST /deauthorize — Facebook deauthorize callback (when user removes the app)
  app.post('/deauthorize', async (request, reply) => {
    try {
      const { signed_request } = request.body || {}
      if (!signed_request) return reply.code(400).send({ error: 'Missing signed_request' })
      return reply.send({ status: 'ok' })
    } catch {
      return reply.code(500).send({ error: 'Failed to process deauthorization' })
    }
  })

  // GET /callback/facebook_page and /callback/instagram — OAuth callbacks
  // Both use Facebook OAuth but with different callback URLs and entity types
  for (const provider of ['facebook_page', 'instagram', 'facebook']) {
    app.get(`/callback/${provider}`, async (request, reply) => {
      const query = request.query

      // Resolve the workspace_id stored in Redis when the OAuth flow started
      let userId = null
      let workspaceId = null
      if (query.state) {
        const raw = await getRedis().get(`oauth_state:${query.state}`)
        if (raw) {
          await getRedis().del(`oauth_state:${query.state}`)
          try { ({ userId, workspaceId } = JSON.parse(raw)) } catch { userId = raw }
        }
      }

      try {
        const providerInstance = await getSocialProvider(provider, { workspace_id: workspaceId })
        const accountData = await providerInstance.handleCallback(query)

        // Store token in Redis temporarily — MongoDB is never touched until the user picks an entity
        const { nanoid } = await import('nanoid')
        const key = nanoid()
        await getRedis().set(
          `oauth_parent:${key}`,
          JSON.stringify({ accountData, userId, workspaceId }),
          'EX', 600
        )
        return reply.redirect(`${WEB_URL}/accounts/entities?provider=${provider}&parent_key=${key}`)
      } catch (err) {
        console.error(`[Callback:${provider}]`, err)
        return reply.redirect(`${WEB_URL}/accounts?error=${encodeURIComponent(err.message)}`)
      }
    })
  }

  // GET /callback/:provider  — generic OAuth callback for non-Meta providers
  app.get('/callback/:provider', async (request, reply) => {
    const { provider } = request.params
    const query = request.query

    let userId = null
    let workspaceId = null
    if (query.state) {
      const raw = await getRedis().get(`oauth_state:${query.state}`)
      if (raw) {
        await getRedis().del(`oauth_state:${query.state}`)
        try { ({ userId, workspaceId } = JSON.parse(raw)) } catch { userId = raw }
      }
    }

    try {
      const providerInstance = await getSocialProvider(provider, { workspace_id: workspaceId })
      const accountData = await providerInstance.handleCallback(query)
      const saved = await Account.upsertAccount({ ...accountData, workspace_id: workspaceId })
      getRedis().publish('agentmarket:account_added', JSON.stringify({ account_id: saved._id.toString() }))
      return reply.redirect(`${WEB_URL}/accounts?connected=1`)
    } catch (err) {
      console.error(`[Callback:${provider}]`, err)
      return reply.redirect(`${WEB_URL}/accounts?error=${encodeURIComponent(err.message)}`)
    }
  })
}
