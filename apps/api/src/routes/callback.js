import * as Account from '../models/Account.js'
import { getSocialProvider } from '../providers/index.js'
import { loadTwitterOAuthSession } from '../providers/twitter.js'
import { getRedis } from '../lib/redis.js'
import { publishEvent } from '../lib/events.js'
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
        const db = (await import('../lib/mongo.js')).getDb()
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

      const [encodedSig, payload] = signed_request.split('.')
      const expectedSig = crypto
        .createHmac('sha256', process.env.META_APP_SECRET || '')
        .update(payload)
        .digest('base64url')

      if (encodedSig !== expectedSig) return reply.code(403).send({ error: 'Invalid signature' })

      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      const userId = data.user_id
      if (userId) {
        const db = (await import('../lib/mongo.js')).getDb()
        await db.collection('accounts').updateMany(
          { 'data.user_id': userId },
          { $set: { authorized: false } }
        )
      }
      return reply.send({ status: 'ok' })
    } catch {
      return reply.code(500).send({ error: 'Failed to process deauthorization' })
    }
  })

  // GET /callback/facebook_page, /callback/instagram, /callback/meta_ads — OAuth callbacks
  // All use Facebook OAuth but with different callback URLs and entity types
  for (const provider of ['facebook_page', 'instagram', 'meta_ads', 'google_ads']) {
    app.get(`/callback/${provider}`, async (request, reply) => {
      const query = request.query

      let userId = null
      let workspaceId = null
      let returnTo = '/accounts'
      if (query.state) {
        const raw = await getRedis().get(`oauth_state:${query.state}`)
        if (raw) {
          await getRedis().del(`oauth_state:${query.state}`)
          try {
            const parsed = JSON.parse(raw)
            userId = parsed.userId
            workspaceId = parsed.workspaceId
            if (parsed.return_to) returnTo = parsed.return_to
          } catch { userId = raw }
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
        const entityReturn =
          provider === 'meta_ads' || provider === 'google_ads'
            ? '/accounts'
            : returnTo
        return reply.redirect(
          `${WEB_URL}/accounts/entities?provider=${provider}&parent_key=${key}&return_to=${encodeURIComponent(entityReturn)}`,
        )
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
    let returnTo = '/accounts'
    if (query.state) {
      const raw = await getRedis().get(`oauth_state:${query.state}`)
      if (raw) {
        await getRedis().del(`oauth_state:${query.state}`)
        try {
          const parsed = JSON.parse(raw)
          userId = parsed.userId
          workspaceId = parsed.workspaceId
          if (parsed.return_to) returnTo = parsed.return_to
        } catch { userId = raw }
      }
    }
    if (provider === 'twitter' && query.oauth_token && !workspaceId) {
      const twitterSession = await loadTwitterOAuthSession(query.oauth_token)
      if (twitterSession) {
        userId = twitterSession.userId || userId
        workspaceId = twitterSession.workspaceId || workspaceId
        if (twitterSession.return_to) returnTo = twitterSession.return_to
      }
    }

    try {
      const providerInstance = await getSocialProvider(provider, { workspace_id: workspaceId })
      const accountData = await providerInstance.handleCallback(query)
      const saved = await Account.upsertAccount({ ...accountData, workspace_id: workspaceId })
      getRedis().publish('agentmarket:account_added', JSON.stringify({ account_id: saved._id.toString() }))
      await publishEvent('integration.connected', {
        provider,
        account_id: String(saved._id),
      }).catch(() => {})
      const dest = returnTo
      const connected = Account.isAdsProvider(provider) ? 'ads' : '1'
      return reply.redirect(`${WEB_URL}${dest}?connected=${connected}`)
    } catch (err) {
      console.error(`[Callback:${provider}]`, err)
      return reply.redirect(`${WEB_URL}/accounts?error=${encodeURIComponent(err.message)}`)
    }
  })
}
