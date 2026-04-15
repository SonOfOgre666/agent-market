import { getDb } from '../db/mongodb.js'
import { ObjectId } from 'mongodb'
import { nanoid } from 'nanoid'

export const COLLECTION = 'tags'

export async function findAll(workspace_id) {
  const filter = workspace_id ? { workspace_id } : {}
  return getDb().collection(COLLECTION).find(filter).sort({ name: 1 }).toArray()
}

export async function findById(id, workspace_id) {
  const filter = { _id: new ObjectId(id) }
  if (workspace_id) filter.workspace_id = workspace_id
  return getDb().collection(COLLECTION).findOne(filter)
}

export async function createTag({ workspace_id, name, hex_color }) {
  const doc = { uuid: nanoid(), workspace_id: workspace_id || null, name, hex_color, created_at: new Date(), updated_at: new Date() }
  const result = await getDb().collection(COLLECTION).insertOne(doc)
  return { ...doc, _id: result.insertedId }
}

export async function updateTag(id, { name, hex_color }) {
  await getDb().collection(COLLECTION).updateOne(
    { _id: new ObjectId(id) },
    { $set: { name, hex_color, updated_at: new Date() } }
  )
  return getDb().collection(COLLECTION).findOne({ _id: new ObjectId(id) })
}

export async function deleteTag(id) {
  // Remove tag from posts
  await getDb().collection('posts').updateMany(
    { tag_ids: id },
    { $pull: { tag_ids: id } }
  )
  return getDb().collection(COLLECTION).deleteOne({ _id: new ObjectId(id) })
}

export function serialize(tag) {
  if (!tag) return null
  return { id: tag._id.toString(), uuid: tag.uuid, name: tag.name, hex_color: tag.hex_color }
}
