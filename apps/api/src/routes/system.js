import { authenticate } from '../middleware/auth.js'
import { getDb } from '../db/mongodb.js'
import { getRedis } from '../db/redis.js'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

const LOG_FILE = path.join(process.cwd(), 'logs', 'app.log')

export default async function systemRoutes(app) {
  // GET /api/system/status
  app.get('/system/status', { preHandler: [authenticate] }, async (request, reply) => {
    // Check MongoDB
    let mongoOk = false
    try {
      await getDb().command({ ping: 1 })
      mongoOk = true
    } catch {}

    // Check Redis
    let redisOk = false
    try {
      await getRedis().ping()
      redisOk = true
    } catch {}

    // Queue stats from Redis
    let queueStats = {}
    try {
      const queued = await getRedis().llen('agentmarket:queue:publish-post')
      const failed = await getRedis().llen('agentmarket:queue:failed')
      queueStats = { queued, failed }
    } catch {}

    return reply.send({
      environment: process.env.NODE_ENV || 'development',
      node_version: process.version,
      platform: os.platform(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      services: {
        mongodb: mongoOk ? 'connected' : 'disconnected',
        redis: redisOk ? 'connected' : 'disconnected',
      },
      queue: queueStats,
    })
  })

  // GET /api/system/logs
  app.get('/system/logs', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const content = await fs.readFile(LOG_FILE, 'utf-8')
      const lines = content.split('\n').filter(Boolean).slice(-200)
      return reply.send({ logs: lines })
    } catch {
      return reply.send({ logs: [] })
    }
  })

  // DELETE /api/system/logs
  app.delete('/system/logs', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      await fs.writeFile(LOG_FILE, '')
    } catch {}
    return reply.send({ message: 'Logs cleared' })
  })
}
