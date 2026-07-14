import './bootstrap-env.js'
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
import { connectMongo } from './lib/mongo.js'
import { getRedis } from './lib/redis.js'
import { startAccountImportListener } from './listeners/accountImportListener.js'
import { registerRoutes } from './registerRoutes.js'

if (!process.env.JWT_SECRET) {
  console.error('[API] JWT_SECRET environment variable is required')
  process.exit(1)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = Fastify({ logger: { level: process.env.NODE_ENV === 'production' ? 'warn' : 'info' } })

await app.register(helmet, {
  global: true,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
})
await app.register(cors, {
  origin: true,
  credentials: true,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  strictPreflight: false,
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Cookie',
    'ngrok-skip-browser-warning',
    'X-Worker-Secret',
    'X-Requested-With',
  ],
})
await app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  redis: getRedis(),
  allowList: (req) => {
    if (req.method === 'OPTIONS') return true
    const path = (req.url || '').split('?')[0]
    // Celery M2M (X-Worker-Secret) must never share the browser bucket — workflow
    // execution fans out dozens of patches/events per minute.
    if (path.startsWith('/api/internal/worker/')) return true
    if (req.method !== 'GET') return false
    // Agent UI polls these while a workflow runs (esp. when realtime WS is down).
    if (
      path.startsWith('/api/agent/jobs/') ||
      path.startsWith('/api/ai/jobs/') ||
      path.startsWith('/api/agent/workflows/')
    ) {
      return true
    }
    return false
  },
})
await app.register(cookie)
await app.register(jwt, {
  secret: process.env.JWT_SECRET,
  cookie: { cookieName: 'token', signed: false },
})
await app.register(multipart, {
  limits: { fileSize: 200 * 1024 * 1024 },
})
await app.register(staticFiles, {
  root: path.join(__dirname, '..', 'uploads'),
  prefix: '/uploads/',
})

app.decorate('authenticate', async (request, reply) => {
  try {
    await request.jwtVerify()
  } catch {
    reply.code(401).send({ error: 'Unauthorized' })
  }
})

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error)
  const statusCode = error.statusCode || 500
  reply.code(statusCode).send({
    error: statusCode === 500 ? 'Internal Server Error' : error.message,
  })
})

await registerRoutes(app)

const start = async () => {
  await connectMongo()
  getRedis()
  startAccountImportListener()
  await app.listen({ port: parseInt(process.env.PORT || '4010'), host: '0.0.0.0' })
  console.log(`[API] Listening on port ${process.env.PORT || 4010}`)
}

start().catch((err) => {
  console.error(err)
  process.exit(1)
})
