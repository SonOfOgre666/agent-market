import { nanoid } from 'nanoid'
import { enqueueCeleryTask } from './celeryEnqueue.js'
import { getRedis } from './redis.js'
import { isOpcodeConfigured, getAssignmentForOpcode } from './aiFeatureRuntime.js'

const DEFAULT_PREFIX = 'agentmarket:ai_sync:'
const META_PREFIX = 'agentmarket:ai_job_meta:'

/**
 * Enqueue ``tasks.ai.gemini_sync``; worker writes JSON to Redis ``job_id`` when done.
 */
export async function enqueueGeminiJob(opcode, payload, { userId = null, workspaceId = null } = {}) {
  const wid = workspaceId || payload?.workspace_id || null
  if (!(await isOpcodeConfigured(wid, opcode))) {
    const e = new Error(
      'This AI feature is not configured. Open AI Integrations, connect the provider, and test the API key.',
    )
    e.statusCode = 500
    throw e
  }
  const assignment = await getAssignmentForOpcode(wid, opcode)
  const body = {
    ...(payload || {}),
    ai_provider: assignment?.provider,
    ai_model: assignment?.model,
    api_model_id: assignment?.api_model_id,
  }
  if (wid) body.workspace_id = wid
  body.execution_source = body.execution_source || 'ui'

  const prefix = process.env.AI_CELERY_REPLY_PREFIX || DEFAULT_PREFIX
  const jobId = `${prefix}${nanoid()}`
  const redis = getRedis()
  const meta = JSON.stringify({ userId, workspaceId: wid, opcode, createdAt: Date.now() })
  await redis.setex(`${META_PREFIX}${jobId}`, 86400, meta)
  await enqueueCeleryTask('tasks.ai.gemini_sync', [opcode, body, jobId])
  return { job_id: jobId }
}

/**
 * Poll result for ``GET /ai/jobs/:jobId`` — verifies JWT user matches enqueue metadata.
 */
export async function getGeminiJob(jobId, { userId }) {
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

  const raw = await redis.get(jobId)
  if (!raw) {
    return { status: 'pending' }
  }

  let json
  try {
    json = JSON.parse(raw)
  } catch {
    return { error: 'invalid_ai_worker_response', statusCode: 502 }
  }

  await redis.del(jobId).catch(() => {})
  await redis.del(`${META_PREFIX}${jobId}`).catch(() => {})

  if (!json.ok) {
    return {
      status: 'complete',
      ok: false,
      error: json.error || 'AI task failed',
      httpStatus: json.status || 502,
    }
  }
  return { status: 'complete', ok: true, data: json.data }
}
