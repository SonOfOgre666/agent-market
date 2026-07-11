import { nanoid } from 'nanoid'
import { enqueueCeleryTask } from './celeryEnqueue.js'
import { getRedis } from './redis.js'
import { isPlannerConfigured } from './aiFeatureRuntime.js'

const DEFAULT_PREFIX = 'agentmarket:agent_sync:'
const META_PREFIX = 'agentmarket:agent_job_meta:'

function createJobId() {
  const prefix = process.env.AGENT_CELERY_REPLY_PREFIX || DEFAULT_PREFIX
  return `${prefix}${nanoid()}`
}

/**
 * Enqueue agent Celery task; worker writes JSON to Redis reply_key when done.
 */
export async function enqueueAgentTask(taskName, args, { userId = null, workspaceId = null } = {}) {
  if (!(await isPlannerConfigured(workspaceId))) {
    const e = new Error(
      'Marketing Assistant agent is not configured. Open AI Integrations and connect the agent provider.',
    )
    e.statusCode = 500
    throw e
  }
  const jobId = createJobId()
  const redis = getRedis()
  await redis.setex(
    `${META_PREFIX}${jobId}`,
    86400,
    JSON.stringify({ userId, workspaceId, taskName, createdAt: Date.now() }),
  )
  await enqueueCeleryTask(taskName, [...args, jobId])
  return { job_id: jobId }
}

/**
 * Poll result for agent async jobs.
 */
export async function getAgentJob(jobId, { userId, workspaceId } = {}) {
  if (!jobId || typeof jobId !== 'string') {
    return { error: 'invalid_job_id', statusCode: 400 }
  }
  const redis = getRedis()
  const metaRaw = await redis.get(`${META_PREFIX}${jobId}`)
  if (!metaRaw) {
    return { error: 'unknown_or_expired_job', statusCode: 404 }
  }
  let meta
  try {
    meta = JSON.parse(metaRaw)
  } catch {
    return { error: 'bad_job_metadata', statusCode: 500 }
  }
  if (meta.userId && String(meta.userId) !== String(userId)) {
    return { error: 'forbidden', statusCode: 403 }
  }
  if (meta.workspaceId && workspaceId && String(meta.workspaceId) !== String(workspaceId)) {
    return { error: 'forbidden', statusCode: 403 }
  }

  const raw = await redis.get(jobId)
  if (!raw) {
    return { status: 'pending' }
  }

  let json
  try {
    json = JSON.parse(raw)
  } catch {
    return { error: 'invalid_worker_response', statusCode: 502 }
  }

  await redis.del(jobId).catch(() => {})
  await redis.del(`${META_PREFIX}${jobId}`).catch(() => {})

  if (!json.ok) {
    return {
      status: 'complete',
      ok: false,
      error: json.error || 'Agent task failed',
      httpStatus: json.status || 502,
    }
  }
  return { status: 'complete', ok: true, data: json.data }
}

export async function enqueuePlanWorkflow({
  workspaceId,
  userId,
  workflowId,
  userMessage,
  conversationHistory = [],
  attachedMedia = [],
}) {
  return enqueueAgentTask(
    'tasks.agent.plan_workflow',
    [workspaceId, workflowId, userMessage, conversationHistory, attachedMedia || []],
    { userId, workspaceId },
  )
}

export async function enqueueExecuteWorkflow({
  workspaceId,
  userId,
  workflowId,
  approved = true,
}) {
  return enqueueAgentTask(
    'tasks.agent.execute_workflow',
    [workspaceId, workflowId, approved],
    { userId, workspaceId },
  )
}
