import { getDb } from '../db/mongodb.js'
import { ObjectId } from 'mongodb'
import { nanoid } from 'nanoid'

const COLLECTION = 'ads_campaigns'

export const CampaignStatus = { DRAFT: 'draft', ACTIVE: 'active', PAUSED: 'paused', ENDED: 'ended' }
export const CampaignPlatform = { GOOGLE: 'google_ads', FACEBOOK: 'facebook', LINKEDIN: 'linkedin', TIKTOK: 'tiktok', INSTAGRAM: 'instagram' }
export const CampaignType = { SEARCH: 'search', DISPLAY: 'display', VIDEO: 'video', SOCIAL: 'social' }

export async function findAll(workspace_id, { status, platform, page = 1, per_page = 20 } = {}) {
  const filter = { workspace_id, deleted_at: null }
  if (status) filter.status = status
  if (platform) filter.platform = platform
  const skip = (page - 1) * per_page
  const [items, total] = await Promise.all([
    getDb().collection(COLLECTION).find(filter).sort({ created_at: -1 }).skip(skip).limit(per_page).toArray(),
    getDb().collection(COLLECTION).countDocuments(filter),
  ])
  return { items, total, page, per_page, last_page: Math.ceil(total / per_page) }
}

export async function findById(id, workspace_id) {
  const filter = { _id: new ObjectId(id), deleted_at: null }
  if (workspace_id) filter.workspace_id = workspace_id
  return getDb().collection(COLLECTION).findOne(filter)
}

export async function findByUuid(uuid, workspace_id) {
  const filter = { uuid, deleted_at: null }
  if (workspace_id) filter.workspace_id = workspace_id
  return getDb().collection(COLLECTION).findOne(filter)
}

export async function createCampaign({ workspace_id, name, platform, type, budget, start_date, end_date, keywords = [], targeting = {}, assets = {} }) {
  const now = new Date()
  const doc = {
    uuid: nanoid(),
    workspace_id,
    name,
    platform,
    type: type || CampaignType.SOCIAL,
    status: CampaignStatus.DRAFT,
    budget: {
      amount: budget?.amount || 0,
      currency: budget?.currency || 'USD',
      type: budget?.type || 'total',
    },
    start_date: start_date ? new Date(start_date) : null,
    end_date: end_date ? new Date(end_date) : null,
    keywords,
    targeting,
    assets,
    metrics: { impressions: 0, clicks: 0, conversions: 0, spend: 0, ctr: 0, cpc: 0, cpa: 0, roas: 0 },
    deleted_at: null,
    created_at: now,
    updated_at: now,
  }
  const result = await getDb().collection(COLLECTION).insertOne(doc)
  return { ...doc, _id: result.insertedId }
}

export async function updateCampaign(id, updates) {
  const now = new Date()
  const allowed = ['name', 'platform', 'type', 'status', 'budget', 'start_date', 'end_date', 'keywords', 'targeting', 'assets', 'metrics']
  const $set = { updated_at: now }
  for (const k of allowed) if (updates[k] !== undefined) $set[k] = updates[k]
  if (updates.start_date) $set.start_date = new Date(updates.start_date)
  if (updates.end_date) $set.end_date = new Date(updates.end_date)
  await getDb().collection(COLLECTION).updateOne({ _id: new ObjectId(id) }, { $set })
  return findById(id)
}

export async function deleteCampaign(id) {
  await getDb().collection(COLLECTION).updateOne({ _id: new ObjectId(id) }, { $set: { deleted_at: new Date() } })
}

export function serialize(c) {
  return {
    id: c._id.toString(),
    uuid: c.uuid,
    workspace_id: c.workspace_id,
    name: c.name,
    platform: c.platform,
    type: c.type,
    status: c.status,
    budget: c.budget,
    start_date: c.start_date,
    end_date: c.end_date,
    keywords: c.keywords || [],
    targeting: c.targeting || {},
    assets: c.assets || {},
    metrics: c.metrics || {},
    created_at: c.created_at,
    updated_at: c.updated_at,
  }
}
