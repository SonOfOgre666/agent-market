import { nanoid } from 'nanoid'
import { getRedis } from './redis.js'

/**
 * Enqueue a Celery task using the same JSON payload shape as /api/ads AI routes.
 * The Python worker must consume the broker (see services/ai-worker).
 */
export async function enqueueCeleryTask(task, args = [], kwargs = {}) {
  const redis = getRedis()
  const queue = process.env.CELERY_REDIS_LIST || 'agentmarket:api_task_bridge'
  const id = nanoid()
  const body = JSON.stringify({
    id,
    task,
    args,
    kwargs,
    retries: 0,
    eta: null,
    expires: null,
    utc: true,
    callbacks: null,
    errbacks: null,
    timelimit: [null, null],
    taskset: null,
    chord: null,
  })
  await redis.lpush(queue, body)
  return id
}
