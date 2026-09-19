import { getDb } from '../lib/mongo.js'
import { ObjectId } from 'mongodb'
import { nanoid } from 'nanoid'
import { normalizeCampaignPlatformQuery } from '../constants/accountKinds.js'

const COLLECTION = 'ads_campaigns'

export const CampaignStatus = { DRAFT: 'draft', ACTIVE: 'active', PAUSED: 'paused', ENDED: 'ended' }
/** Canonical paid-ads platforms (UI + new campaigns). */
export const CampaignPlatform = { GOOGLE: 'google_ads', META: 'meta_ads' }
export const ADS_CAMPAIGN_PLATFORMS = ['google_ads', 'meta_ads']
export const CampaignType = { SEARCH: 'search', DISPLAY: 'display', VIDEO: 'video', SOCIAL: 'social' }
export const ScheduleStatus = { PENDING: 'pending', PROCESSING: 'processing', PROCESSED: 'processed' }

export async function findAll(workspace_id, { status, platform, page = 1, per_page = 20 } = {}) {
  const filter = { workspace_id, deleted_at: null }
  if (status && String(status) !== 'undefined') filter.status = status
  if (platform) {
    const canonical = normalizeCampaignPlatformQuery(platform)
    if (canonical === 'meta_ads') {
      filter.platform = { $in: ['meta_ads', 'meta', 'facebook'] }
    } else if (canonical === 'google_ads') {
      filter.platform = { $in: ['google_ads', 'google'] }
    } else if (canonical) {
      filter.platform = canonical
    }
  }
  const skip = (page - 1) * per_page
  const [items, total] = await Promise.all([
    getDb().collection(COLLECTION).find(filter).sort({ created_at: -1 }).skip(skip).limit(per_page).toArray(),
    getDb().collection(COLLECTION).countDocuments(filter),
  ])
  return { items, total, page, per_page, last_page: Math.ceil(total / per_page) }
}

export async function findById(id, workspace_id) {
  try {
    const filter = { _id: new ObjectId(id), deleted_at: null }
    if (workspace_id) filter.workspace_id = workspace_id
    return getDb().collection(COLLECTION).findOne(filter)
  } catch {
    return null // id is not a valid 24-char ObjectId hex — caller should use findByUuid
  }
}

export async function findByUuid(uuid, workspace_id) {
  const filter = { uuid, deleted_at: null }
  if (workspace_id) filter.workspace_id = workspace_id
  return getDb().collection(COLLECTION).findOne(filter)
}

// Find campaigns scheduled to launch now (like Post's findScheduledReady)
export async function findScheduledReady() {
  const now = new Date()
  return getDb().collection(COLLECTION).find({
    deleted_at: null,
    status: CampaignStatus.DRAFT,
    schedule_status: ScheduleStatus.PENDING,
    scheduled_at: { $lte: now },
  }).toArray()
}

export async function createCampaign({
  workspace_id,
  name,
  platform,
  type,
  budget,
  start_date,
  end_date,
  keywords = [],
  targeting = {},
  assets = {},
  objective = null,
  creatives = {},
  account_id = null,
  ad_account_id = null,
  goal = null,
  pixel_id = null,
  custom_event_type = null,
  application_id = null,
  object_store_url = null,
  lead_gen_form_id = null,
}) {
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
      type: budget?.type || 'daily',
    },
    start_date: start_date ? new Date(start_date) : null,
    end_date: end_date ? new Date(end_date) : null,
    keywords,
    targeting,
    assets,
    // Ad publishing fields
    objective: objective || goal || null,
    creatives,
    pixel_id: pixel_id || null,
    custom_event_type: custom_event_type || null,
    application_id: application_id || null,
    object_store_url: object_store_url || null,
    lead_gen_form_id: lead_gen_form_id || creatives?.lead_gen_form_id || null,
    account_id: account_id || null,
    ad_account_id: ad_account_id || null,
    scheduled_at: null,
    schedule_status: null,
    platform_campaign_id: null,
    platform_ad_set_id: null,
    platform_ad_id: null,
    published_at: null,
    publish_errors: [],
    metrics: { impressions: 0, clicks: 0, conversions: 0, spend: 0, conversion_value: 0, ctr: 0, cpc: 0, cpa: 0, roas: 0 },
    deleted_at: null,
    created_at: now,
    updated_at: now,
  }
  const result = await getDb().collection(COLLECTION).insertOne(doc)
  return { ...doc, _id: result.insertedId }
}

export async function updateCampaign(id, updates) {
  const now = new Date()
  const allowed = [
    'name', 'platform', 'type', 'status', 'budget', 'start_date', 'end_date',
    'keywords', 'targeting', 'assets', 'metrics', 'objective', 'creatives',
    'account_id', 'ad_account_id', 'scheduled_at', 'schedule_status',
    'platform_campaign_id', 'platform_ad_set_id', 'platform_ad_id',
    'published_at', 'publish_errors',
  ]
  const $set = { updated_at: now }
  for (const k of allowed) if (updates[k] !== undefined) $set[k] = updates[k]
  if (updates.start_date) $set.start_date = new Date(updates.start_date)
  if (updates.end_date) $set.end_date = new Date(updates.end_date)
  if (updates.scheduled_at) $set.scheduled_at = new Date(updates.scheduled_at)
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
    objective: c.objective || null,
    creatives: c.creatives || {},
    account_id: c.account_id || null,
    ad_account_id: c.ad_account_id || null,
    scheduled_at: c.scheduled_at || null,
    schedule_status: c.schedule_status || null,
    platform_campaign_id: c.platform_campaign_id || null,
    platform_ad_set_id: c.platform_ad_set_id || null,
    platform_ad_id: c.platform_ad_id || null,
    published_at: c.published_at || null,
    publish_errors: c.publish_errors || [],
    metrics: c.metrics || {},
    created_at: c.created_at,
    updated_at: c.updated_at,
  }
}
