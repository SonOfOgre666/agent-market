import { getRedis } from './redis.js'
import { getDb } from './mongo.js'

const defaultChannel = () => process.env.EVENTS_CHANNEL || 'agent_market:events'

/**
 * Publish a JSON event to Redis (SocketCluster relay) and append to event_logs when Mongo is up.
 */
export async function publishEvent(event, payload = {}) {
  const channel = defaultChannel()
  const body = JSON.stringify({ event, ...payload })
  try {
    await getRedis().publish(channel, body)
  } catch {
    // ignore
  }
  try {
    await getDb().collection('event_logs').insertOne({
      event,
      payload,
      created_at: new Date(),
    })
  } catch {
    // ignore if DB down or collection missing
  }
}
