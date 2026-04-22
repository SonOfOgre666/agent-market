import { config } from 'dotenv'
config({ path: new URL('../../../.env', import.meta.url) })
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import staticFiles from '@fastify/static'
import path from 'path'
import { fileURLToPath } from 'url'
import { connectMongo } from './db/mongodb.js'
import { getRedis } from './db/redis.js'
import { startScheduler } from './queue/scheduler.js'
import { startAccountImportListener } from './listeners/accountImportListener.js'

// Routes
import authRoutes from './routes/auth.js'
import dashboardRoutes from './routes/dashboard.js'
import postRoutes from './routes/posts.js'
import accountRoutes from './routes/accounts.js'
import mediaRoutes from './routes/media.js'
import tagRoutes from './routes/tags.js'
import calendarRoutes from './routes/calendar.js'
import reportRoutes from './routes/reports.js'
import settingRoutes from './routes/settings.js'
import serviceRoutes from './routes/services.js'
import profileRoutes from './routes/profile.js'
import systemRoutes from './routes/system.js'
import callbackRoutes from './routes/callback.js'
import socialRoutes from './routes/social.js'
import workspaceRoutes from './routes/workspace.js'
import adsRoutes from './routes/ads.js'
import integrationsRoutes from './routes/integrations.js'
import aiRoutes from './routes/ai.js'

if (!process.env.JWT_SECRET) {
  console.error('[API] JWT_SECRET environment variable is required')
  process.exit(1)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = Fastify({ logger: { level: process.env.NODE_ENV === 'production' ? 'warn' : 'info' } })

// Plugins
await app.register(helmet, {
  global: true,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false, // API serves JSON only, no need for CSP
})
await app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  redis: getRedis(),
})
await app.register(cors, {
  origin: true, // Accept any origin — API is protected by JWT auth
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'ngrok-skip-browser-warning'],
})
await app.register(cookie)
await app.register(jwt, {
  secret: process.env.JWT_SECRET,
  cookie: { cookieName: 'token', signed: false },
})
await app.register(multipart, {
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
})
await app.register(staticFiles, {
  root: path.join(__dirname, '..', 'uploads'),
  prefix: '/uploads/',
})

// Auth decorator
app.decorate('authenticate', async (request, reply) => {
  try {
    await request.jwtVerify()
  } catch {
    reply.code(401).send({ error: 'Unauthorized' })
  }
})

// Global error handler
app.setErrorHandler((error, _request, reply) => {
  app.log.error(error)
  const statusCode = error.statusCode || 500
  reply.code(statusCode).send({
    error: statusCode === 500 ? 'Internal Server Error' : error.message,
  })
})

// Routes — all under /api prefix
app.register(authRoutes, { prefix: '/api' })
app.register(dashboardRoutes, { prefix: '/api' })
app.register(postRoutes, { prefix: '/api' })
app.register(accountRoutes, { prefix: '/api' })
app.register(mediaRoutes, { prefix: '/api' })
app.register(tagRoutes, { prefix: '/api' })
app.register(calendarRoutes, { prefix: '/api' })
app.register(reportRoutes, { prefix: '/api' })
app.register(settingRoutes, { prefix: '/api' })
app.register(serviceRoutes, { prefix: '/api' })
app.register(profileRoutes, { prefix: '/api' })
app.register(systemRoutes, { prefix: '/api' })
app.register(callbackRoutes, { prefix: '' }) // OAuth callbacks at root
app.register(socialRoutes, { prefix: '/api' })
app.register(workspaceRoutes, { prefix: '/api' })
app.register(adsRoutes, { prefix: '/api' })
app.register(integrationsRoutes, { prefix: '/api' })
app.register(aiRoutes, { prefix: '/api' })

// TikTok domain verification
app.get('/tiktokP1WpivbX114kIZl7T5p8D0ZMm6kDH9uO.txt', async (_request, reply) => {
  return reply.code(200).header('Content-Type', 'text/plain').send('tiktok-developers-site-verification=P1WpivbX114kIZl7T5p8D0ZMm6kDH9uO')
})

// Root endpoint
app.get('/', async (_request, reply) => {
  return reply.code(200).send({
    message: 'Agent Market API',
    version: '1.0.0',
    status: 'running',
  })
})

// Health check — verifies MongoDB and Redis connectivity
app.get('/api/health', async (_request, reply) => {
  let mongoOk = false
  let redisOk = false
  try {
    const { getDb } = await import('./db/mongodb.js')
    await getDb().command({ ping: 1 })
    mongoOk = true
  } catch {}
  try {
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

// Boot
const start = async () => {
  await connectMongo()
  getRedis() // initialise connection
  startAccountImportListener()
  await startScheduler()
  await app.listen({ port: parseInt(process.env.PORT || '4010'), host: '0.0.0.0' })
  console.log(`[API] Listening on port ${process.env.PORT || 4010}`)
}

start().catch((err) => {
  console.error(err)
  process.exit(1)
})
