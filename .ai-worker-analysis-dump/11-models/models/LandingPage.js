import { getDb } from '../lib/mongo.js'
import { ObjectId } from 'mongodb'
import { nanoid } from 'nanoid'

const COLLECTION = 'ads_landing_pages'

export function sanitizeSlug(input) {
  const slug = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return slug || 'landing-page'
}

async function resolveUniqueSlug(preferred, fallbackTitle) {
  const base = sanitizeSlug(preferred) || sanitizeSlug(fallbackTitle)
  let slug = base
  let i = 1
  while (await getDb().collection(COLLECTION).findOne({ slug })) {
    slug = `${base}-${i++}`
  }
  return slug
}

export async function findAll(workspace_id, { status, page = 1, per_page = 20 } = {}) {
  const filter = { workspace_id, deleted_at: null }
  if (status) filter.status = status
  const skip = (page - 1) * per_page
  const [items, total] = await Promise.all([
    getDb().collection(COLLECTION).find(filter).sort({ created_at: -1 }).skip(skip).limit(per_page).toArray(),
    getDb().collection(COLLECTION).countDocuments(filter),
  ])
  return { items, total, page, per_page }
}

export async function findById(id, workspace_id) {
  const filter = { _id: new ObjectId(id), deleted_at: null }
  if (workspace_id) filter.workspace_id = workspace_id
  return getDb().collection(COLLECTION).findOne(filter)
}

export async function findBySlug(slug) {
  return getDb().collection(COLLECTION).findOne({ slug, status: 'published', deleted_at: null })
}

export async function createLandingPage({ workspace_id, campaign_id, title, slug: preferredSlug, headline, subheadline, body, cta_text, cta_url, form_fields, meta }) {
  const now = new Date()
  const slug = await resolveUniqueSlug(preferredSlug, title)
  const doc = {
    uuid: nanoid(),
    workspace_id,
    campaign_id: campaign_id || null,
    title,
    slug,
    headline: headline || title,
    subheadline: subheadline || '',
    body: body || '',
    cta_text: cta_text || 'Get Started',
    cta_url: cta_url || '',
    form_fields: form_fields || [
      { name: 'name', type: 'text', label: 'Full Name', required: true },
      { name: 'email', type: 'email', label: 'Email Address', required: true },
    ],
    meta: meta || {},
    status: 'draft',
    lead_count: 0,
    view_count: 0,
    deleted_at: null,
    created_at: now,
    updated_at: now,
  }
  const result = await getDb().collection(COLLECTION).insertOne(doc)
  return { ...doc, _id: result.insertedId }
}

export async function updateLandingPage(id, updates) {
  const allowed = ['title', 'headline', 'subheadline', 'body', 'cta_text', 'cta_url', 'form_fields', 'meta', 'status']
  const $set = { updated_at: new Date() }
  for (const k of allowed) if (updates[k] !== undefined) $set[k] = updates[k]
  await getDb().collection(COLLECTION).updateOne({ _id: new ObjectId(id) }, { $set })
  return findById(id)
}

export async function incrementViewCount(id) {
  await getDb().collection(COLLECTION).updateOne({ _id: new ObjectId(id) }, { $inc: { view_count: 1 } })
}

export async function incrementLeadCount(id) {
  await getDb().collection(COLLECTION).updateOne({ _id: new ObjectId(id) }, { $inc: { lead_count: 1 } })
}

export async function deleteLandingPage(id) {
  await getDb().collection(COLLECTION).updateOne({ _id: new ObjectId(id) }, { $set: { deleted_at: new Date() } })
}

export function serialize(p) {
  return {
    id: p._id.toString(),
    uuid: p.uuid,
    workspace_id: p.workspace_id,
    campaign_id: p.campaign_id,
    title: p.title,
    slug: p.slug,
    headline: p.headline,
    subheadline: p.subheadline,
    body: p.body,
    cta_text: p.cta_text,
    cta_url: p.cta_url,
    form_fields: p.form_fields || [],
    meta: p.meta || {},
    status: p.status,
    lead_count: p.lead_count || 0,
    view_count: p.view_count || 0,
    created_at: p.created_at,
    updated_at: p.updated_at,
  }
}
