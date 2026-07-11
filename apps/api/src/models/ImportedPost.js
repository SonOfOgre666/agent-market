import { getDb } from '../lib/mongo.js'

export const COLLECTION = 'imported_posts'

export async function upsert(account_id, provider_post_id, content, metrics = {}) {
  await getDb().collection(COLLECTION).updateOne(
    { account_id, provider_post_id },
    {
      $set: { account_id, provider_post_id, content, metrics, updated_at: new Date() },
      $setOnInsert: { created_at: new Date() },
    },
    { upsert: true }
  )
}

export async function findByAccount(account_id, { page = 1, per_page = 20 } = {}) {
  const skip = (page - 1) * per_page
  const [items, total] = await Promise.all([
    getDb().collection(COLLECTION).find({ account_id }).sort({ created_at: -1 }).skip(skip).limit(per_page).toArray(),
    getDb().collection(COLLECTION).countDocuments({ account_id }),
  ])
  return { items, total, page, per_page, last_page: Math.ceil(total / per_page) }
}
