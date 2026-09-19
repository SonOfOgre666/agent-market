import { getDb } from '../lib/mongo.js'

import crypto from 'crypto'

export const COLLECTION = 'integrations'

/** Integration provider keys (API credentials stored per workspace). */
export const INTEGRATION_NAMES = [
  'twitter',
  'facebook',
  'tiktok',
  'linkedin',
  'instagram_login',
  'unsplash',
  'giphy',
  'google_ads',
  'openai',
  'anthropic',
  'gemini',
  'openrouter',
  'ollama',
]

/** Stored under Settings → AI (provider API keys). */
export const AI_PROVIDER_NAMES = ['openai', 'anthropic', 'gemini', 'openrouter', 'ollama']

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
  const row = await findByName(name, workspace_id)
  if (!row) return {}
  return decrypt(row.configuration)
}

export async function upsertIntegration(name, configuration, workspace_id, active = true) {
  const encrypted = encrypt(configuration)
  const existing = await findByName(name, workspace_id)
  if (existing) {
    await getDb().collection(COLLECTION).updateOne(
      { _id: existing._id },
      { $set: { configuration: encrypted, active, updated_at: new Date() } },
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

export async function setTestStatus(name, workspace_id, test_status) {
  const filter = { name }
  if (workspace_id) filter.workspace_id = workspace_id
  await getDb().collection(COLLECTION).updateOne(filter, {
    $set: { test_status, tested_at: new Date(), updated_at: new Date() },
  })
}

export async function getProviderMeta(workspace_id) {
  const rows = await findAll(workspace_id)
  const byName = Object.fromEntries(rows.map(r => [r.name, r]))
  return byName
}

export function serialize(integration, includeConfig = false) {
  if (!integration) return null
  const out = {
    id: integration._id.toString(),
    name: integration.name,
    active: integration.active,
    test_status: integration.test_status || null,
    tested_at: integration.tested_at || null,
  }
  if (includeConfig) out.configuration = decrypt(integration.configuration)
  return out
}

/** True if workspace has credentials stored (api_key, or base_url for Ollama). */
export async function hasApiKey(name, workspace_id) {
  const cfg = await getDecryptedConfig(name, workspace_id)
  if (name === 'ollama') {
    return Boolean((cfg.base_url || '').trim())
  }
  return Boolean((cfg.api_key || '').trim())
}
