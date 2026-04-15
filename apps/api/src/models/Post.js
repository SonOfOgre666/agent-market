import { getDb } from '../db/mongodb.js'
import { ObjectId } from 'mongodb'
import { nanoid } from 'nanoid'

export const COLLECTION = 'posts'

// Status values (mirrors Laravel enums)
export const PostStatus = { DRAFT: 0, SCHEDULED: 1, PUBLISHED: 2, FAILED: 3 }
export const ScheduleStatus = { PENDING: 0, PROCESSING: 1, PROCESSED: 2 }

export async function findAll({ workspace_id, status, tag_id, keyword, account_id, page = 1, per_page = 15 } = {}) {
  const filter = { deleted_at: null }
  if (workspace_id) filter.workspace_id = workspace_id
  if (status !== undefined && status !== null && status !== '') filter.status = parseInt(status)
  if (tag_id)     filter.tag_ids    = tag_id
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

export async function findForCalendar({ workspace_id, date, type = 'month' }) {
  const d = new Date(date)
  let start, end
  if (type === 'month') {
    start = new Date(d.getFullYear(), d.getMonth(), 1)
    end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59)
  } else if (type === 'week') {
    const day = d.getDay()
    start = new Date(d); start.setDate(d.getDate() - day)
    end = new Date(start); end.setDate(start.getDate() + 6)
    end.setHours(23, 59, 59)
  } else {
    start = new Date(d.setHours(0, 0, 0, 0))
    end = new Date(d.setHours(23, 59, 59, 999))
  }
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

export async function createPost({ workspace_id, account_ids = [], tag_ids = [], versions = [], scheduled_at } = {}) {
  const now = new Date()
  const doc = {
    uuid: nanoid(),
    workspace_id: workspace_id || null,
    status: scheduled_at ? PostStatus.SCHEDULED : PostStatus.DRAFT,
    schedule_status: ScheduleStatus.PENDING,
    scheduled_at: scheduled_at ? new Date(scheduled_at) : null,
    published_at: null,
    account_ids,
    tag_ids,
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

export async function duplicatePost(id, workspace_id) {
  const original = await getDb().collection(COLLECTION).findOne({ _id: new ObjectId(id), deleted_at: null })
  if (!original) return null
  const { _id, uuid, created_at, updated_at, deleted_at, published_at, ...fields } = original
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
  return {
    ...post,
    id: post._id.toString(),
    _id: undefined,
  }
}
