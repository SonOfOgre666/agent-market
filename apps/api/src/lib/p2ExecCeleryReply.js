import { nanoid } from 'nanoid'
import { enqueueCeleryTask } from './celeryEnqueue.js'
import { getRedis } from './redis.js'

const DEFAULT_PREFIX = 'agentmarket:p2_exec_reply:'

function replyPrefix() {
  return (process.env.P2_CELERY_REPLY_PREFIX || DEFAULT_PREFIX).replace(/\/+$/, '')
}

/**
 * LPUSH Celery bridge envelope with ``replyKey`` appended to ``args``, then poll Redis for JSON
 * ``{ ok, data, error, status }`` (same shape as ``tasks.ai.gemini_sync``).
 */
export async function enqueueCeleryAndWaitForJson(task, argsBeforeReplyKey, {
  timeoutMs = 45000,
  intervalMs = 200,
} = {}) {
  const replyKey = `${replyPrefix()}:${nanoid()}`
  const redis = getRedis()
  await enqueueCeleryTask(task, [...argsBeforeReplyKey, replyKey])
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const raw = await redis.get(replyKey)
    if (raw) {
      await redis.del(replyKey).catch(() => {})
      try {
        return JSON.parse(raw)
      } catch {
        const e = new Error('Invalid worker JSON reply')
        e.statusCode = 502
        throw e
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  const e = new Error('Worker execution timeout')
  e.statusCode = 504
  throw e
}
