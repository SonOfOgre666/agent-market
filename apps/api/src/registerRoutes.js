/**
 * API route registration (ONBOARDING §3 — index.js registers routes).
 * Bootstrapping (plugins, listen) stays in server.js.
 */
import authRoutes from './routes/auth.js'
import dashboardRoutes from './routes/dashboard.js'
import postRoutes from './routes/posts.js'
import accountRoutes from './routes/accounts.js'
import mediaRoutes from './routes/media.js'
import calendarRoutes from './routes/calendar.js'
import reportRoutes from './routes/reports.js'
import settingRoutes from './routes/settings.js'
import profileRoutes from './routes/profile.js'
import systemRoutes from './routes/system.js'
import callbackRoutes from './routes/callback.js'
import workspaceRoutes from './routes/workspace.js'
import adsRoutes from './routes/ads.js'
import integrationsRoutes from './routes/integrations.js'
import aiRoutes from './routes/ai.js'
import aiWorkspaceRoutes from './routes/aiWorkspace.js'
import agentRoutes from './routes/agent.js'
import workerInternalRoutes from './routes/worker_internal.js'
import socialCommentsRoutes from './routes/socialComments.js'
import seoRoutes from './routes/seo.js'

/** Register all HTTP routes on the Fastify instance. */
export async function registerRoutes(app) {
  await app.register(authRoutes, { prefix: '/api' })
  await app.register(dashboardRoutes, { prefix: '/api' })
  await app.register(postRoutes, { prefix: '/api' })
  await app.register(accountRoutes, { prefix: '/api' })
  await app.register(mediaRoutes, { prefix: '/api' })
  await app.register(calendarRoutes, { prefix: '/api' })
  await app.register(reportRoutes, { prefix: '/api' })
  await app.register(settingRoutes, { prefix: '/api' })
  await app.register(profileRoutes, { prefix: '/api' })
  await app.register(systemRoutes, { prefix: '/api' })
  await app.register(callbackRoutes, { prefix: '' })
  await app.register(workspaceRoutes, { prefix: '/api' })
  await app.register(adsRoutes, { prefix: '/api' })
  await app.register(integrationsRoutes, { prefix: '/api' })
  await app.register(aiRoutes, { prefix: '/api' })
  await app.register(aiWorkspaceRoutes, { prefix: '/api' })
  await app.register(agentRoutes, { prefix: '/api' })
  await app.register(socialCommentsRoutes, { prefix: '/api' })
  await app.register(seoRoutes, { prefix: '/api' })
  await app.register(workerInternalRoutes, { prefix: '/api' })

  app.get('/tiktokP1WpivbX114kIZl7T5p8D0ZMm6kDH9uO.txt', async (_request, reply) => {
    return reply.code(200).header('Content-Type', 'text/plain').send('tiktok-developers-site-verification=P1WpivbX114kIZl7T5p8D0ZMm6kDH9uO')
  })

  app.get('/', async (_request, reply) => {
    return reply.code(200).send({
      message: 'Agent Market API',
      version: '1.0.0',
      status: 'running',
    })
  })

  app.get('/api/health', async (_request, reply) => {
    let mongoOk = false
    let redisOk = false
    try {
      const { getDb } = await import('./lib/mongo.js')
      await getDb().command({ ping: 1 })
      mongoOk = true
    } catch {}
    try {
      const { getRedis } = await import('./lib/redis.js')
      await getRedis().ping()
      redisOk = true
    } catch {}
    const healthy = mongoOk && redisOk
    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: { mongodb: mongoOk ? 'connected' : 'disconnected', redis: redisOk ? 'connected' : 'disconnected' },
    })
  })
}
