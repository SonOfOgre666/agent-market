import { getDb } from '../lib/mongo.js'
import { ObjectId } from 'mongodb'
import { nanoid } from 'nanoid'
import fs from 'fs/promises'
import path from 'path'

export const COLLECTION = 'media'

export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'video/x-m4v']
export const MAX_SIZE = { image: 20 * 1024 * 1024, gif: 15 * 1024 * 1024, video: 200 * 1024 * 1024 }

export async function findAll({ workspace_id, page = 1, per_page = 24 } = {}) {
  const filter = workspace_id ? { workspace_id } : {}
  const skip = (page - 1) * per_page
  const [items, total] = await Promise.all([
    getDb().collection(COLLECTION).find(filter).sort({ created_at: -1 }).skip(skip).limit(per_page).toArray(),
    getDb().collection(COLLECTION).countDocuments(filter),
  ])
  return { items, total, page, per_page, last_page: Math.ceil(total / per_page) }
}

export async function findById(id) {
  return getDb().collection(COLLECTION).findOne({ _id: new ObjectId(id) })
}

export async function findByUuid(uuid) {
  return getDb().collection(COLLECTION).findOne({ uuid })
}

export async function createMedia({ workspace_id, name, mime_type, disk = 'local', path: filePath, size, size_total, conversions = [] }) {
  const doc = {
    uuid: nanoid(),
    workspace_id: workspace_id || null,
    name,
    mime_type,
    disk,
    path: filePath,
    size,
    size_total: size_total || size,
    conversions,
    created_at: new Date(),
    updated_at: new Date(),
  }
  const result = await getDb().collection(COLLECTION).insertOne(doc)
  return { ...doc, _id: result.insertedId }
}

export async function updateConversions(id, conversions) {
  await getDb().collection(COLLECTION).updateOne(
    { _id: new ObjectId(id) },
    { $set: { conversions, updated_at: new Date() } }
  )
}

export async function deleteMediaItems(ids) {
  const objectIds = ids.map(id => new ObjectId(id))
  const items = await getDb().collection(COLLECTION).find({ _id: { $in: objectIds } }).toArray()

  for (const item of items) {
    try {
      const uploadDir = process.env.STORAGE_LOCAL_PATH || './uploads'
      await fs.unlink(path.join(uploadDir, item.path)).catch(() => {})
      for (const conv of item.conversions || []) {
        await fs.unlink(path.join(uploadDir, conv.path)).catch(() => {})
      }
    } catch {}
  }

  return getDb().collection(COLLECTION).deleteMany({ _id: { $in: objectIds } })
}

export function getPublicUrl(media) {
  if (!media) return null
  const base = process.env.API_URL || 'http://localhost:4010'
  return `${base}/uploads/${media.path}`
}

export function serialize(media) {
  if (!media) return null
  return {
    id: media._id.toString(),
    uuid: media.uuid,
    name: media.name,
    mime_type: media.mime_type,
    disk: media.disk,
    url: getPublicUrl(media),
    size: media.size,
    size_total: media.size_total,
    conversions: (media.conversions || []).map(c => ({
      ...c,
      url: `${process.env.API_URL || 'http://localhost:4010'}/uploads/${c.path}`,
    })),
    created_at: media.created_at,
  }
}
