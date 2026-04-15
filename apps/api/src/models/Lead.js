import { getDb } from '../db/mongodb.js'
import { ObjectId } from 'mongodb'
import { nanoid } from 'nanoid'

const COLLECTION = 'ads_leads'

export async function findAll(workspace_id, { landing_page_id, campaign_id, page = 1, per_page = 30 } = {}) {
  const filter = { workspace_id }
  if (landing_page_id) filter.landing_page_id = landing_page_id
  if (campaign_id) filter.campaign_id = campaign_id
  const skip = (page - 1) * per_page
  const [items, total] = await Promise.all([
    getDb().collection(COLLECTION).find(filter).sort({ created_at: -1 }).skip(skip).limit(per_page).toArray(),
    getDb().collection(COLLECTION).countDocuments(filter),
  ])
  return { items, total, page, per_page, last_page: Math.ceil(total / per_page) }
}

export async function createLead({ workspace_id, landing_page_id, landing_page_slug, campaign_id, data, utm, ip, user_agent }) {
  const now = new Date()
  const doc = {
    uuid: nanoid(),
    workspace_id,
    landing_page_id: landing_page_id || null,
    landing_page_slug: landing_page_slug || null,
    campaign_id: campaign_id || null,
    data: data || {},
    utm: utm || {},
    ip: ip || null,
    user_agent: user_agent || null,
    created_at: now,
  }
  const result = await getDb().collection(COLLECTION).insertOne(doc)
  return { ...doc, _id: result.insertedId }
}

export function serialize(l) {
  return {
    id: l._id.toString(),
    uuid: l.uuid,
    landing_page_id: l.landing_page_id,
    landing_page_slug: l.landing_page_slug,
    campaign_id: l.campaign_id,
    data: l.data || {},
    utm: l.utm || {},
    created_at: l.created_at,
  }
}
