import Redis from 'ioredis'

let redisClient
let redisSub

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
}

export function getRedis() {
  if (!redisClient) {
    redisClient = new Redis(redisConfig)
    redisClient.on('connect', () => console.log('[Redis] Connected'))
    redisClient.on('error', (err) => console.error('[Redis] Error', err))
  }
  return redisClient
}

export function getRedisSub() {
  if (!redisSub) {
    redisSub = new Redis(redisConfig)
  }
  return redisSub
}

export async function disconnectRedis() {
  if (redisClient) await redisClient.quit()
  if (redisSub) await redisSub.quit()
}
