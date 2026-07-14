import { getDb } from '../lib/mongo.js'
import { getRedis } from '../lib/redis.js'

export const COLLECTION = 'settings'

// Mirrors Settings.php form() — all fields with their defaults
const DEFAULTS = {
  timezone:       'UTC',
  date_format:    'human',   // 'human' = relative (e.g. "2 hours ago") | 'full' = absolute
  time_format:    12,
  week_starts_on: 1,         // 0 = Sunday, 1 = Monday, 6 = Saturday
  admin_email:    '',
  default_accounts: [],
  auto_analyze_comments: false,
  agent_auto_approve: false,
}

// Mirrors Settings.php rules()
const VALID_TIMEZONES = Intl.supportedValuesOf('timeZone')

const WEEKDAY_NAMES = {
  sunday: 0, monday: 1, saturday: 6,
}

function normalizeWeekStartsOn(value) {
  if (typeof value === 'string') {
    const mapped = WEEKDAY_NAMES[value.toLowerCase()]
    if (mapped !== undefined) return mapped
  }
  const n = Number(value)
  return [0, 1, 6].includes(n) ? n : undefined
}

export function validate(settings) {
  const errors = {}
  if (settings.timezone !== undefined && !VALID_TIMEZONES.includes(settings.timezone)) {
    errors.timezone = 'Invalid timezone'
  }
  if (settings.time_format !== undefined && ![12, 24, '12', '24'].includes(settings.time_format)) {
    errors.time_format = 'Must be 12 or 24'
  }
  if (settings.week_starts_on !== undefined) {
    const week = normalizeWeekStartsOn(settings.week_starts_on)
    if (week === undefined) {
      errors.week_starts_on = 'Must be 0 (Sunday), 1 (Monday), or 6 (Saturday)'
    }
  }
  if (settings.admin_email !== undefined && settings.admin_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.admin_email)) {
    errors.admin_email = 'Invalid email address'
  }
  if (settings.default_accounts !== undefined && !Array.isArray(settings.default_accounts)) {
    errors.default_accounts = 'Must be an array'
  }
  if (settings.auto_analyze_comments !== undefined && typeof settings.auto_analyze_comments !== 'boolean') {
    errors.auto_analyze_comments = 'Must be true or false'
  }
  if (settings.agent_auto_approve !== undefined && typeof settings.agent_auto_approve !== 'boolean') {
    errors.agent_auto_approve = 'Must be true or false'
  }
  return Object.keys(errors).length ? errors : null
}

const CACHE_PREFIX = 'agentmarket:settings:'

function cacheKey(name, workspace_id) {
  return `${CACHE_PREFIX}${workspace_id ? workspace_id + ':' : ''}${name}`
}

export async function get(name, workspace_id) {
  const key = cacheKey(name, workspace_id)
  const cached = await getRedis().get(key).catch(() => null)
  if (cached !== null) {
    try { return JSON.parse(cached) } catch { return cached }
  }

  const filter = { name }
  if (workspace_id) filter.workspace_id = workspace_id
  const doc = await getDb().collection(COLLECTION).findOne(filter)
  const value = doc ? doc.payload : (DEFAULTS[name] ?? null)

  await getRedis().setex(key, 3600, JSON.stringify(value)).catch(() => {})
  return value
}

export async function getAll(workspace_id) {
  const result = { ...DEFAULTS }
  const filter = workspace_id ? { workspace_id } : {}
  const docs = await getDb().collection(COLLECTION).find(filter).toArray()
  for (const doc of docs) result[doc.name] = doc.payload
  return result
}

export async function set(name, payload, workspace_id) {
  const filter = { name }
  if (workspace_id) filter.workspace_id = workspace_id
  await getDb().collection(COLLECTION).updateOne(
    filter,
    { $set: { name, workspace_id: workspace_id || null, payload, updated_at: new Date() } },
    { upsert: true }
  )
  await getRedis().del(cacheKey(name, workspace_id)).catch(() => {})
}

export async function setMany(settings, workspace_id) {
  for (const [name, payload] of Object.entries(settings)) {
    if (!(name in DEFAULTS)) continue
    let value = payload
    if (name === 'week_starts_on') {
      const normalized = normalizeWeekStartsOn(payload)
      if (normalized !== undefined) value = normalized
    }
    await set(name, value, workspace_id)
  }
}

export async function forgetAll(workspace_id) {
  for (const name of Object.keys(DEFAULTS)) {
    await getRedis().del(cacheKey(name, workspace_id)).catch(() => {})
  }
}
