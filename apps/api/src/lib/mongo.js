import { MongoClient } from 'mongodb'
import { migrateServicesToIntegrations } from './migrateIntegrations.js'
import { seedCatalogIfMissing } from '../models/AiCatalog.js'

let client
let db

export async function connectMongo() {
  if (db) return db
  client = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017/mixpost')
  await client.connect()
  db = client.db()
  await migrateServicesToIntegrations(db)
  await createIndexes(db)
  await seedCatalogIfMissing()
  console.log('[MongoDB] Connected')
  return db
}

export function getDb() {
  if (!db) throw new Error('MongoDB not connected. Call connectMongo() first.')
  return db
}

async function createIndexes(db) {
  await db.collection('accounts').createIndex({ provider: 1, provider_id: 1 }, { unique: true })
  await db.collection('posts').createIndex({ uuid: 1 }, { unique: true })
  await db.collection('posts').createIndex({ scheduled_at: 1 })
  await db.collection('posts').createIndex({ status: 1, schedule_status: 1 })
  await db.collection('tags').createIndex({ uuid: 1 }, { unique: true })
  await db.collection('media').createIndex({ uuid: 1 }, { unique: true })
  await db.collection('imported_posts').createIndex({ account_id: 1, provider_post_id: 1 }, { unique: true })
  await db.collection('facebook_insights').createIndex({ account_id: 1, type: 1, date: 1 }, { unique: true })
  await db.collection('metrics').createIndex({ account_id: 1, date: 1 }, { unique: true })
  await db.collection('audience').createIndex({ account_id: 1, date: 1 })
  await db.collection('settings').createIndex({ name: 1, workspace_id: 1 }, { unique: true })
  await db.collection('integrations').createIndex({ name: 1, workspace_id: 1 }, { unique: true })
  await db.collection('ai_workspace_configs').createIndex({ workspace_id: 1 }, { unique: true })
  // ai_catalog uses _id: "global" — _id is already unique by default in MongoDB
  await db.collection('event_logs').createIndex({ created_at: -1 })
  await db.collection('ads_keyword_research').createIndex({ workspace_id: 1, created_at: -1 })
  await db.collection('ads_metrics').createIndex({ campaign_id: 1, recorded_at: -1 })
  await db.collection('social_comments').createIndex({ workspace_id: 1, created_at: -1 })
  await db.collection('social_comments').createIndex({ userId: 1, created_at: -1 })
  await db.collection('post_comments').createIndex({ workspace_id: 1, post_id: 1, platform_created_at: -1 })
  await db.collection('post_comments').createIndex({ workspace_id: 1, created_at: -1 })
  await db.collection('post_comments').createIndex(
    { account_id: 1, provider_comment_id: 1 },
    { unique: true },
  )
  await db.collection('post_comments').createIndex({ uuid: 1 }, { unique: true })
  await db.collection('ai_executions').createIndex({ workspace_id: 1, created_at: -1 })
  await db.collection('ai_executions').createIndex({ workspace_id: 1, feature_id: 1, created_at: -1 })
  await db.collection('ai_executions').createIndex({ workspace_id: 1, provider: 1, created_at: -1 })
}

export async function disconnectMongo() {
  if (client) await client.close()
}
