import { getDb } from '../db/mongodb.js'

import crypto from 'crypto'

export const COLLECTION = 'services'

// Service names matching Laravel's ServiceGroup
export const SERVICE_NAMES = ['twitter', 'facebook', 'tiktok', 'linkedin', 'instagram_login', 'unsplash', 'giphy', 'google_ads']

const ENCRYPT_KEY = (process.env.APP_KEY || 'agentmarket-default-key-32bytes!!').slice(0, 32)
const IV_LEN = 16

function encrypt(text) {
  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPT_KEY), iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(text)), cipher.final()])
  return iv.toString('hex') + ':' + encrypted.toString('hex')
}

function decrypt(text) {
  try {
    const [ivHex, encHex] = text.split(':')
    const iv = Buffer.from(ivHex, 'hex')
    const enc = Buffer.from(encHex, 'hex')
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPT_KEY), iv)
    const decrypted = Buffer.concat([decipher.update(enc), decipher.final()])
    return JSON.parse(decrypted.toString())
  } catch {
    return {}
  }
}

export async function findAll(workspace_id) {
  const filter = workspace_id ? { workspace_id } : {}
  return getDb().collection(COLLECTION).find(filter).toArray()
}

export async function findByName(name, workspace_id) {
  const filter = { name }
  if (workspace_id) filter.workspace_id = workspace_id
  return getDb().collection(COLLECTION).findOne(filter)
}

export async function getDecryptedConfig(name, workspace_id) {
  const service = await findByName(name, workspace_id)
  if (!service) return {}
  return decrypt(service.configuration)
}

export async function upsertService(name, configuration, workspace_id, active = true) {
  const encrypted = encrypt(configuration)
  const existing = await findByName(name, workspace_id)
  if (existing) {
    await getDb().collection(COLLECTION).updateOne(
      { _id: existing._id },
      { $set: { configuration: encrypted, active, updated_at: new Date() } }
    )
  } else {
    await getDb().collection(COLLECTION).insertOne({
      name,
      workspace_id: workspace_id || null,
      configuration: encrypted,
      active,
      created_at: new Date(),
      updated_at: new Date(),
    })
  }
  return findByName(name, workspace_id)
}

export function serialize(service, includeConfig = false) {
  if (!service) return null
  const out = { id: service._id.toString(), name: service.name, active: service.active }
  if (includeConfig) out.configuration = decrypt(service.configuration)
  return out
}
