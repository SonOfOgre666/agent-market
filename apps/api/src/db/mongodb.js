import { MongoClient } from 'mongodb'

let client
let db

export async function connectMongo() {
  if (db) return db
  client = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017/mixpost')
  await client.connect()
  db = client.db()
  await createIndexes(db)
  console.log('[MongoDB] Connected')
  return db
}

export function getDb() {
  if (!db) throw new Error('MongoDB not connected. Call connectMongo() first.')
  return db
}

async function createIndexes(db) {
  // accounts
  await db.collection('accounts').createIndex({ provider: 1, provider_id: 1 }, { unique: true })
  // posts
  await db.collection('posts').createIndex({ uuid: 1 }, { unique: true })
  await db.collection('posts').createIndex({ scheduled_at: 1 })
  await db.collection('posts').createIndex({ status: 1, schedule_status: 1 })
  // tags
  await db.collection('tags').createIndex({ uuid: 1 }, { unique: true })
  // media
  await db.collection('media').createIndex({ uuid: 1 }, { unique: true })
  // imported_posts
  await db.collection('imported_posts').createIndex({ account_id: 1, provider_post_id: 1 }, { unique: true })
  // facebook_insights
  await db.collection('facebook_insights').createIndex({ account_id: 1, type: 1, date: 1 }, { unique: true })
  // metrics
  await db.collection('metrics').createIndex({ account_id: 1, date: 1 }, { unique: true })
  // audience
  await db.collection('audience').createIndex({ account_id: 1, date: 1 })
  // settings — unique per (name, workspace_id) so each workspace has its own values
  await db.collection('settings').createIndex({ name: 1, workspace_id: 1 }, { unique: true })
  // services — unique per (name, workspace_id)
  await db.collection('services').createIndex({ name: 1, workspace_id: 1 }, { unique: true })
}

export async function disconnectMongo() {
  if (client) await client.close()
}
