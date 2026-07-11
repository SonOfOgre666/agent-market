import { getDb } from '../lib/mongo.js'
import { getCatalog } from './AiCatalog.js'

export const COLLECTION = 'ai_executions'

export const FEATURE_LABELS = {
  planner: 'Planner',
  post_generation: 'Post Gen',
  image_generation: 'Image Gen',
  video_generation: 'Video Gen',
  image_script: 'Image Script',
  video_script: 'Video Script',
  google_search_marketing: 'Google Ads Marketing',
  meta_ad_marketing: 'Meta Ads',
  landing_page_copy: 'Landing Page',
  key_test: 'Key Test',
}

const OPCODE_TO_FEATURE = {
  generate_post: 'post_generation',
  generate_image: 'image_generation',
  generate_video: 'video_generation',
  generate_image_script: 'image_script',
  generate_video_script: 'video_script',
  generate_script: 'video_script',
  planner: 'planner',
  landing_page_plan: 'landing_page_copy',
}

function featureLabel(featureId) {
  return FEATURE_LABELS[featureId] || featureId || 'AI'
}

async function resolveModelLabel(modelId) {
  if (!modelId) return ''
  try {
    const catalog = await getCatalog()
    return catalog?.model_labels?.[modelId] || modelId
  } catch {
    return modelId
  }
}

export async function insertExecution(row) {
  const now = new Date()
  const featureId = row.feature_id
    || OPCODE_TO_FEATURE[row.opcode]
    || row.opcode
    || 'unknown'
  const doc = {
    workspace_id: String(row.workspace_id || ''),
    created_at: now,
    feature_id: featureId,
    feature: row.feature || featureLabel(featureId),
    opcode: row.opcode || null,
    provider: (row.provider || '').toLowerCase() || null,
    model: row.model || null,
    api_model_id: row.api_model_id || null,
    execution_type: row.execution_type || 'text',
    input_tokens: numOrNull(row.input_tokens),
    output_tokens: numOrNull(row.output_tokens),
    total_tokens: numOrNull(row.total_tokens),
    duration_ms: numOrNull(row.duration_ms),
    status: row.status === 'failed' ? 'failed' : 'success',
    error: row.error ? String(row.error).slice(0, 2000) : null,
    source: row.source || null,
  }
  if (!doc.workspace_id) {
    const err = new Error('workspace_id is required')
    err.statusCode = 400
    throw err
  }
  const result = await getDb().collection(COLLECTION).insertOne(doc)
  return { ...doc, _id: result.insertedId }
}

function numOrNull(v) {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}

export async function listByWorkspace(workspace_id, { page = 1, per_page = 50, feature_id, provider } = {}) {
  const filter = { workspace_id: String(workspace_id) }
  if (feature_id) filter.feature_id = String(feature_id)
  if (provider) filter.provider = String(provider).toLowerCase()

  const skip = Math.max(0, (page - 1) * per_page)
  const limit = Math.min(Math.max(1, per_page), 200)

  const coll = getDb().collection(COLLECTION)
  const [items, total] = await Promise.all([
    coll.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit).toArray(),
    coll.countDocuments(filter),
  ])

  const serialized = await Promise.all(items.map(serialize))
  return {
    items: serialized,
    total,
    page,
    per_page: limit,
    pages: Math.ceil(total / limit) || 1,
  }
}

export async function serialize(doc) {
  if (!doc) return null
  const modelLabel = await resolveModelLabel(doc.model)
  return {
    id: doc._id.toString(),
    workspace_id: doc.workspace_id,
    created_at: doc.created_at,
    feature_id: doc.feature_id,
    feature: doc.feature || featureLabel(doc.feature_id),
    opcode: doc.opcode,
    provider: doc.provider,
    model: doc.model,
    model_label: modelLabel,
    api_model_id: doc.api_model_id,
    execution_type: doc.execution_type,
    input_tokens: doc.input_tokens,
    output_tokens: doc.output_tokens,
    total_tokens: doc.total_tokens,
    duration_ms: doc.duration_ms,
    status: doc.status,
    error: doc.error,
    source: doc.source,
  }
}
