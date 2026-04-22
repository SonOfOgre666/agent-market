import { config } from 'dotenv'
config({ path: new URL('../../../../.env', import.meta.url) })
import { connectMongo } from '../db/mongodb.js'
import { getRedis } from '../db/redis.js'
import { publishPostJob } from '../jobs/PublishPost.js'
import { importAccountJob } from '../jobs/ImportAccount.js'
import { processMetricsJob } from '../jobs/ProcessMetrics.js'
import { importTwitterFollowersJob } from '../jobs/ImportTwitterFollowers.js'
import { importTwitterPostsJob } from '../jobs/ImportTwitterPosts.js'
import { processTwitterMetricsJob } from '../jobs/ProcessTwitterMetrics.js'
import { importFacebookFollowersJob } from '../jobs/ImportFacebookFollowers.js'
import { importFacebookInsightsJob } from '../jobs/ImportFacebookInsights.js'
import { importInstagramFollowersJob } from '../jobs/ImportInstagramFollowers.js'

const QUEUE_KEY = 'agentmarket:queue'
const QUEUES = ['publish-post', 'imports']
const MAX_ATTEMPTS = 3

const JOB_MAP = {
  PublishPost:             publishPostJob,
  ImportAccount:           importAccountJob,
  ProcessMetrics:          processMetricsJob,
  ImportTwitterFollowers:  importTwitterFollowersJob,
  ImportTwitterPosts:      importTwitterPostsJob,
  ProcessTwitterMetrics:   processTwitterMetricsJob,
  ImportFacebookFollowers:  importFacebookFollowersJob,
  ImportFacebookInsights:   importFacebookInsightsJob,
  ImportInstagramFollowers: importInstagramFollowersJob,
}

async function processMessage(queue, raw) {
  let message
  try { message = JSON.parse(raw) } catch {
    console.error(`[Worker:${queue}] Bad message format`)
    return
  }

  const handler = JOB_MAP[message.job]
  if (!handler) {
    console.warn(`[Worker:${queue}] Unknown job: ${message.job}`)
    return
  }

  try {
    console.log(`[Worker:${queue}] → ${message.job}`, message.payload)
    await handler(message.payload)
    console.log(`[Worker:${queue}] ✓ ${message.job}`)
  } catch (err) {
    message.attempts = (message.attempts || 0) + 1
    message.last_error = err.message
    console.error(`[Worker:${queue}] ✗ ${message.job} (attempt ${message.attempts}): ${err.message}`)

    if (message.attempts < MAX_ATTEMPTS) {
      // Exponential backoff: 5s, 10s, 20s
      const delay = message.attempts * 5000
      setTimeout(() => getRedis().rpush(`${QUEUE_KEY}:${queue}`, JSON.stringify(message)), delay)
    } else {
      await getRedis().rpush(`${QUEUE_KEY}:failed`, JSON.stringify(message))
    }
  }
}

async function poll(queue) {
  const redis = getRedis()
  while (true) {
    try {
      const result = await redis.blpop(`${QUEUE_KEY}:${queue}`, 5)
      if (result) {
        const [, raw] = result
        await processMessage(queue, raw)
      }
    } catch (err) {
      console.error(`[Worker:${queue}] Poll error:`, err.message)
      await new Promise(r => setTimeout(r, 1000))
    }
  }
}

async function start() {
  await connectMongo()
  console.log('[Worker] Started — queues:', QUEUES.join(', '))
  await Promise.all(QUEUES.map(q => poll(q)))
}

start().catch(err => { console.error('[Worker] Fatal:', err); process.exit(1) })
