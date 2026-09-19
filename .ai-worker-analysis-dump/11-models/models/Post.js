import { getDb } from '../lib/mongo.js'
import { ObjectId } from 'mongodb'
import { nanoid } from 'nanoid'

export const COLLECTION = 'posts'

// Status values (mirrors Laravel enums)
export const PostStatus = { DRAFT: 0, SCHEDULED: 1, PUBLISHED: 2, FAILED: 3 }
export const ScheduleStatus = { PENDING: 0, PROCESSING: 1, PROCESSED: 2 }

export async function findAll({ workspace_id, status, keyword, account_id, page = 1, per_page = 15 } = {}) {
  const filter = { deleted_at: null }
  if (workspace_id) filter.workspace_id = workspace_id
  if (status !== undefined && status !== null && status !== '') filter.status = parseInt(status)
  if (account_id) filter.account_ids = account_id

  if (keyword) {
    const re = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    filter['versions.content.body'] = re
  }

  const skip = (page - 1) * per_page
  const [items, total] = await Promise.all([
    getDb().collection(COLLECTION).find(filter).sort({ created_at: -1 }).skip(skip).limit(per_page).toArray(),
    getDb().collection(COLLECTION).countDocuments(filter),
  ])
  return { items, total, page, per_page, last_page: Math.ceil(total / per_page) }
}

export async function findById(id, workspace_id) {
  const filter = { _id: new ObjectId(id), deleted_at: null }
  if (workspace_id) filter.workspace_id = workspace_id
  return getDb().collection(COLLECTION).findOne(filter)
}

export async function findByUuid(uuid, workspace_id) {
  const filter = { uuid, deleted_at: null }
  if (workspace_id) filter.workspace_id = workspace_id
  return getDb().collection(COLLECTION).findOne(filter)
}

export async function findForCalendar({ workspace_id, date }) {
  const d = new Date(`${date}-01T12:00:00`)
  const start = new Date(d.getFullYear(), d.getMonth(), 1)
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59)
  const filter = {
    deleted_at: null,
    scheduled_at: { $gte: start, $lte: end },
  }
  if (workspace_id) filter.workspace_id = workspace_id
  return getDb().collection(COLLECTION).find(filter).sort({ scheduled_at: 1 }).toArray()
}

export async function findScheduledReady() {
  // Worker runs without user context — finds all ready posts across all users
  return getDb().collection(COLLECTION).find({
    deleted_at: null,
    status: PostStatus.SCHEDULED,
    schedule_status: ScheduleStatus.PENDING,
    scheduled_at: { $lte: new Date() },
  }).toArray()
}

export async function createPost({ workspace_id, account_ids = [], versions = [], scheduled_at, status } = {}) {
  const now = new Date()
  const doc = {
    uuid: nanoid(),
    workspace_id: workspace_id || null,
    status: status !== undefined ? status : (scheduled_at ? PostStatus.SCHEDULED : PostStatus.DRAFT),
    schedule_status: ScheduleStatus.PENDING,
    scheduled_at: scheduled_at ? new Date(scheduled_at) : null,
    published_at: null,
    account_ids,
    versions,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  }
  const result = await getDb().collection(COLLECTION).insertOne(doc)
  return { ...doc, _id: result.insertedId }
}

export async function updatePost(id, fields) {
  fields.updated_at = new Date()
  await getDb().collection(COLLECTION).updateOne({ _id: new ObjectId(id) }, { $set: fields })
  return getDb().collection(COLLECTION).findOne({ _id: new ObjectId(id), deleted_at: null })
}

export async function deletePost(id) {
  return getDb().collection(COLLECTION).updateOne(
    { _id: new ObjectId(id) },
    { $set: { deleted_at: new Date() } }
  )
}

export async function deleteManyPosts(ids) {
  const objectIds = ids.map(id => new ObjectId(id))
  return getDb().collection(COLLECTION).updateMany(
    { _id: { $in: objectIds } },
    { $set: { deleted_at: new Date() } }
  )
}

export async function findPublishAccountResults(postId) {
  return getDb()
    .collection('post_accounts')
    .find({ post_id: String(postId) })
    .toArray()
}

export async function findPublishSummaries(postIds = []) {
  const ids = postIds.map(String).filter(Boolean)
  if (!ids.length) return {}

  const rows = await getDb()
    .collection('post_accounts')
    .find({ post_id: { $in: ids } })
    .toArray()

  return rows.reduce((acc, row) => {
    const postId = String(row.post_id)
    const current = acc[postId] || { total: 0, succeeded: 0, failed: 0, partial: false }
    const failed = Array.isArray(row.errors) && row.errors.length > 0
    current.total += 1
    if (failed) current.failed += 1
    else current.succeeded += 1
    current.partial = current.succeeded > 0 && current.failed > 0
    acc[postId] = current
    return acc
  }, {})
}

export async function duplicatePost(id, workspace_id) {
  const original = await getDb().collection(COLLECTION).findOne({ _id: new ObjectId(id), deleted_at: null })
  if (!original) return null
  const { _id, uuid, created_at, updated_at, deleted_at, published_at, tag_ids: _tags, ...fields } = original
  return createPost({
    ...fields,
    workspace_id: workspace_id || fields.workspace_id,
    status: PostStatus.DRAFT,
    schedule_status: ScheduleStatus.PENDING,
    scheduled_at: null,
  })
}

export function serialize(post) {
  if (!post) return null
  const { _id, tag_ids, ...rest } = post
  return {
    ...rest,
    id: _id.toString(),
  }
}
