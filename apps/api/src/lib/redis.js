import Redis from 'ioredis'

let redisClient
let redisSub

/** Read env at connect time — avoids NOAUTH when .env loads after a module was first evaluated. */
function redisOptions() {
  const pw = process.env.REDIS_PASSWORD
  const password = pw != null && String(pw).trim() !== '' ? String(pw).trim() : undefined
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  }
}

export function getRedis() {
  if (!redisClient) {
    redisClient = new Redis(redisOptions())
    redisClient.on('connect', () => console.log('[Redis] Connected'))
    redisClient.on('error', (err) => console.error('[Redis] Error', err))
  }
  return redisClient
}

export function getRedisSub() {
  if (!redisSub) {
    redisSub = new Redis(redisOptions())
  }
  return redisSub
}

export async function disconnectRedis() {
  if (redisClient) await redisClient.quit()
  if (redisSub) await redisSub.quit()
}
