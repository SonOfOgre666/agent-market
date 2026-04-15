import { getDb } from '../db/mongodb.js'
import { ObjectId } from 'mongodb'
import { nanoid } from 'nanoid'

export const COLLECTION = 'accounts'

// Supported providers
export const PROVIDERS = ['twitter', 'facebook', 'instagram', 'instagram_login', 'mastodon', 'tiktok', 'linkedin']

// Providers that require at least one media item to publish
export const MEDIA_REQUIRED_PROVIDERS = ['instagram', 'instagram_login', 'tiktok']

export async function findAll(workspace_id) {
  const filter = workspace_id ? { workspace_id } : {}
  return getDb().collection(COLLECTION).find(filter).sort({ created_at: 1 }).toArray()
}

export async function findById(id) {
  return getDb().collection(COLLECTION).findOne({ _id: new ObjectId(id) })
}

export async function findByUuid(uuid) {
  return getDb().collection(COLLECTION).findOne({ uuid })
}

export async function findByProvider(provider, providerId) {
  return getDb().collection(COLLECTION).findOne({ provider, provider_id: providerId })
}

export async function upsertAccount({ workspace_id, provider, provider_id, name, username, media, data, access_token, authorized = true, pending_entities = false }) {
  const now = new Date()
  const existing = await findByProvider(provider, provider_id)
  if (existing) {
    await getDb().collection(COLLECTION).updateOne(
      { _id: existing._id },
      { $set: { name, username, media, data, access_token, authorized, updated_at: now, pending_entities, ...(workspace_id && { workspace_id }) } }
    )
    return findById(existing._id.toString())
  }
  const doc = {
    uuid: nanoid(),
    workspace_id: workspace_id || null,
    provider,
    provider_id,
    name,
    username,
    media: media || {},
    data: data || {},
    access_token,
    authorized,
    pending_entities,
    created_at: now,
    updated_at: now,
  }
  const result = await getDb().collection(COLLECTION).insertOne(doc)
  return { ...doc, _id: result.insertedId }
}

export async function updateAccount(id, fields) {
  fields.updated_at = new Date()
  await getDb().collection(COLLECTION).updateOne({ _id: new ObjectId(id) }, { $set: fields })
  return findById(id)
}

export async function deleteAccount(id) {
  return getDb().collection(COLLECTION).deleteOne({ _id: new ObjectId(id) })
}

export function serialize(account) {
  if (!account) return null
  return {
    id: account._id.toString(),
    uuid: account.uuid,
    name: account.name,
    username: account.username,
    provider: account.provider,
    provider_id: account.provider_id,
    media: account.media || {},
    data: account.data || {},
    authorized: account.authorized,
    created_at: account.created_at,
  }
}
