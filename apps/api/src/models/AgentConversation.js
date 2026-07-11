import { getDb } from '../lib/mongo.js'
import { ObjectId } from 'mongodb'
import { nanoid } from 'nanoid'

export const COLLECTION = 'agent_conversations'

export async function findById(id, workspace_id) {
  const filter = { _id: new ObjectId(id) }
  if (workspace_id) filter.workspace_id = workspace_id
  return getDb().collection(COLLECTION).findOne(filter)
}

export async function create({ workspace_id, user_id, title = null }) {
  const now = new Date()
  const doc = {
    workspace_id,
    user_id,
    title: title || 'Marketing assistant',
    messages: [],
    created_at: now,
    updated_at: now,
  }
  const res = await getDb().collection(COLLECTION).insertOne(doc)
  return { ...doc, _id: res.insertedId }
}

export async function appendMessage(conversationId, workspace_id, message) {
  const filter = { _id: new ObjectId(conversationId) }
  if (workspace_id) filter.workspace_id = workspace_id
  const entry = {
    id: nanoid(),
    role: message.role,
    content: message.content,
    workflow_id: message.workflow_id || null,
    attachments: Array.isArray(message.attachments) && message.attachments.length
      ? message.attachments
      : null,
    created_at: new Date(),
  }
  await getDb().collection(COLLECTION).updateOne(filter, {
    $push: { messages: entry },
    $set: { updated_at: new Date() },
  })
  return entry
}

export async function listRecent(workspace_id, { limit = 20 } = {}) {
  return getDb().collection(COLLECTION)
    .find({ workspace_id })
    .sort({ updated_at: -1 })
    .limit(limit)
    .toArray()
}

export async function deleteById(id, workspace_id) {
  const filter = { _id: new ObjectId(id) }
  if (workspace_id) filter.workspace_id = workspace_id
  const res = await getDb().collection(COLLECTION).deleteOne(filter)
  return res.deletedCount > 0
}

export function serialize(doc) {
  if (!doc) return null
  return {
    id: doc._id.toString(),
    workspace_id: doc.workspace_id,
    user_id: doc.user_id,
    title: doc.title,
    messages: (doc.messages || []).map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      workflow_id: m.workflow_id || null,
      attachments: m.attachments || null,
      created_at: m.created_at,
    })),
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  }
}
