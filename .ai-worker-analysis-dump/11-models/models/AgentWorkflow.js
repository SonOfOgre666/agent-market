import { getDb } from '../lib/mongo.js'
import { ObjectId } from 'mongodb'
import { nanoid } from 'nanoid'

export const COLLECTION = 'agent_workflows'

export const WorkflowStatus = {
  PENDING: 'pending',
  PLANNING: 'planning',
  PLANNED: 'planned',
  AWAITING_APPROVAL: 'awaiting_approval',
  APPROVED: 'approved',
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
}

export async function findById(id, workspace_id) {
  const filter = { _id: new ObjectId(id) }
  if (workspace_id) filter.workspace_id = workspace_id
  return getDb().collection(COLLECTION).findOne(filter)
}

export async function create({
  workspace_id,
  user_id,
  conversation_id,
  user_message,
  attached_media,
  status = WorkflowStatus.PLANNING,
}) {
  const now = new Date()
  const workflow_id = `wf_${nanoid(12)}`
  const doc = {
    workflow_id,
    workspace_id,
    user_id,
    conversation_id: conversation_id || null,
    user_message,
    attached_media: Array.isArray(attached_media) && attached_media.length ? attached_media : null,
    status,
    intent: null,
    summary: null,
    graph: null,
    approval_gates: [],
    step_results: null,
    execution_errors: [],
    created_at: now,
    updated_at: now,
  }
  const res = await getDb().collection(COLLECTION).insertOne(doc)
  return { ...doc, _id: res.insertedId }
}

export async function listRecent(workspace_id, { limit = 20 } = {}) {
  return getDb().collection(COLLECTION)
    .find({ workspace_id })
    .sort({ updated_at: -1 })
    .limit(limit)
    .toArray()
}

export async function deleteByConversationId(conversation_id, workspace_id) {
  const filter = { conversation_id }
  if (workspace_id) filter.workspace_id = workspace_id
  const res = await getDb().collection(COLLECTION).deleteMany(filter)
  return res.deletedCount
}

export async function patch(id, workspace_id, fields) {
  const filter = { _id: new ObjectId(id) }
  if (workspace_id) filter.workspace_id = workspace_id
  const $set = { updated_at: new Date() }
  const allowed = [
    'status', 'intent', 'summary', 'graph', 'approval_gates',
    'step_results', 'execution_errors', 'approved_at', 'approved_by',
  ]
  for (const k of allowed) {
    if (fields[k] !== undefined) $set[k] = fields[k]
  }
  await getDb().collection(COLLECTION).updateOne(filter, { $set })
  return findById(id, workspace_id)
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'awaiting_approval'])
const INTERRUPTED_MSG = 'Step interrupted — worker stopped before completion.'

function normalizeStepResults(stepResults, workflowStatus) {
  if (!stepResults || typeof stepResults !== 'object') return stepResults
  if (!TERMINAL_STATUSES.has(workflowStatus)) return stepResults

  let changed = false
  const out = { ...stepResults }
  for (const [sid, row] of Object.entries(out)) {
    if (row?.status === 'running') {
      out[sid] = {
        ...row,
        status: 'failed',
        error: row.error || INTERRUPTED_MSG,
      }
      changed = true
    }
  }
  return changed ? out : stepResults
}

export function serialize(doc) {
  if (!doc) return null
  const status = doc.status
  return {
    id: doc._id.toString(),
    workflow_id: doc.workflow_id,
    workspace_id: doc.workspace_id,
    conversation_id: doc.conversation_id,
    user_message: doc.user_message,
    status,
    intent: doc.intent,
    summary: doc.summary,
    graph: doc.graph,
    approval_gates: doc.approval_gates || [],
    step_results: normalizeStepResults(doc.step_results, status),
    execution_errors: doc.execution_errors || [],
    created_at: doc.created_at,
    updated_at: doc.updated_at,
    approved_at: doc.approved_at,
  }
}
