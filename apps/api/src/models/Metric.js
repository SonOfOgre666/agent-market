import { getDb } from '../db/mongodb.js'
import { ObjectId } from 'mongodb'

export const COLLECTION = 'metrics'

export async function upsert(account_id, date, data) {
  const dateStr = typeof date === 'string' ? date : date.toISOString().split('T')[0]
  await getDb().collection(COLLECTION).updateOne(
    { account_id, date: dateStr },
    { $set: { account_id, date: dateStr, data, updated_at: new Date() }, $setOnInsert: { created_at: new Date() } },
    { upsert: true }
  )
}

export async function findByAccount(account_id, { from, to } = {}) {
  const filter = { account_id }
  if (from || to) {
    filter.date = {}
    if (from) filter.date.$gte = from
    if (to) filter.date.$lte = to
  }
  return getDb().collection(COLLECTION).find(filter).sort({ date: 1 }).toArray()
}

// Audience (follower counts)
export async function upsertAudience(account_id, date, total) {
  const dateStr = typeof date === 'string' ? date : date.toISOString().split('T')[0]
  await getDb().collection('audience').updateOne(
    { account_id, date: dateStr },
    { $set: { account_id, date: dateStr, total, updated_at: new Date() }, $setOnInsert: { created_at: new Date() } },
    { upsert: true }
  )
}

export async function findAudienceByAccount(account_id, { from, to } = {}) {
  const filter = { account_id }
  if (from || to) {
    filter.date = {}
    if (from) filter.date.$gte = from
    if (to) filter.date.$lte = to
  }
  return getDb().collection('audience').find(filter).sort({ date: 1 }).toArray()
}

// Facebook Insights
export async function upsertFacebookInsight(account_id, type, value, date) {
  const dateStr = typeof date === 'string' ? date : date.toISOString().split('T')[0]
  await getDb().collection('facebook_insights').updateOne(
    { account_id, type, date: dateStr },
    { $set: { account_id, type, value, date: dateStr, updated_at: new Date() }, $setOnInsert: { created_at: new Date() } },
    { upsert: true }
  )
}

export async function findFacebookInsightsByAccount(account_id, { from, to } = {}) {
  const filter = { account_id }
  if (from || to) {
    filter.date = {}
    if (from) filter.date.$gte = from
    if (to) filter.date.$lte = to
  }
  return getDb().collection('facebook_insights').find(filter).sort({ date: 1 }).toArray()
}
