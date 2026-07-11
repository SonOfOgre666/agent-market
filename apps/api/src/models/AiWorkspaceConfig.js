import { getDb } from '../lib/mongo.js'
import {
  getCatalog,
  catalogViews,
  validateFeatureAssignment,
  validatePlannerAssignment,
} from './AiCatalog.js'
import { remapLegacyModelId } from '../lib/aiCatalogSeed.js'
import { getWorkspaceCatalogViews } from '../lib/aiCatalogWorkspace.js'

export const COLLECTION = 'ai_workspace_configs'

function pickModelForProvider(views, featureId, providerId, preferredModel) {
  const isPlanner = featureId === 'planner'
  const models = isPlanner
    ? (views.planner_models_by_provider[providerId] || []).map(m => m.id)
    : (views.models_by_provider_feature[featureId]?.[providerId] || []).map(m => m.id)
  const remapped = remapLegacyModelId(preferredModel)
  if (!providerId) return ''
  if (providerId === 'ollama') {
    if (models.includes(remapped)) return remapped
    return models[0] || remapped || ''
  }
  if (models.includes(remapped)) return remapped
  return remapped || models[0] || ''
}

function normalizeFeatureRow(views, featureId, stored = {}) {
  const provider = (stored.provider || '').trim().toLowerCase()
  if (!provider) return { provider: '', model: '' }
  const model = pickModelForProvider(views, featureId, provider, stored.model || '')
  return { provider, model }
}

function normalizePlannerRow(views, stored = {}) {
  const provider = (stored.provider || '').trim().toLowerCase()
  if (!provider) {
    return {
      provider: '',
      model: '',
      max_workflow_steps: Number(stored.max_workflow_steps ?? 10),
    }
  }
  const model = pickModelForProvider(views, 'planner', provider, stored.model || '')
  return {
    provider,
    model,
    max_workflow_steps: Number(stored.max_workflow_steps ?? 10),
  }
}

function emptyFeatureMap(catalog) {
  const out = {}
  for (const id of catalog.feature_ids || []) {
    out[id] = { provider: '', model: '' }
  }
  return out
}

async function mergeFeatures(workspace_id, stored = {}) {
  const catalog = await getCatalog()
  const views = workspace_id
    ? await getWorkspaceCatalogViews(workspace_id)
    : catalogViews(catalog)
  const legacyBrief = stored.campaign_brief
  const adsMarketingIds = ['google_search_marketing', 'meta_ad_marketing', 'landing_page_copy']
  const out = {}
  for (const id of catalog.feature_ids || []) {
    const inherited = !stored[id] && legacyBrief && adsMarketingIds.includes(id) ? legacyBrief : {}
    out[id] = normalizeFeatureRow(views, id, {
      ...inherited,
      ...(stored[id] || {}),
    })
  }
  return out
}

async function mergePlanner(workspace_id, stored = {}) {
  const catalog = await getCatalog()
  const views = workspace_id
    ? await getWorkspaceCatalogViews(workspace_id)
    : catalogViews(catalog)
  return normalizePlannerRow(views, stored)
}

export async function findByWorkspace(workspace_id) {
  return getDb().collection(COLLECTION).findOne({ workspace_id })
}

export async function getConfig(workspace_id) {
  const doc = await findByWorkspace(workspace_id)
  return {
    features: await mergeFeatures(workspace_id, doc?.features),
    planner: await mergePlanner(workspace_id, doc?.planner),
  }
}

export async function upsertFeatures(workspace_id, featuresPatch) {
  const doc = await findByWorkspace(workspace_id)
  const merged = await mergeFeatures(workspace_id, { ...(doc?.features || {}), ...(featuresPatch || {}) })
  const catalog = await getCatalog()
  for (const id of catalog.feature_ids || []) {
    const row = merged[id]
    if (!row?.provider || !row?.model) continue
    const err = await validateFeatureAssignment(id, row.provider, row.model, workspace_id)
    if (err) {
      const e = new Error(err)
      e.statusCode = 422
      throw e
    }
  }
  const now = new Date()
  await getDb().collection(COLLECTION).updateOne(
    { workspace_id },
    {
      $set: { features: merged, updated_at: now },
      $setOnInsert: {
        workspace_id,
        created_at: now,
        planner: { max_workflow_steps: 10 },
      },
    },
    { upsert: true },
  )
  return getConfig(workspace_id)
}

export async function upsertPlanner(workspace_id, planner) {
  const merged = await mergePlanner(workspace_id, planner)
  if (merged.provider && merged.model) {
    const err = await validatePlannerAssignment(
      merged.provider,
      merged.model,
      merged.max_workflow_steps,
      workspace_id,
    )
    if (err) {
      const e = new Error(err)
      e.statusCode = 422
      throw e
    }
  }
  const catalog = await getCatalog()
  const now = new Date()
  await getDb().collection(COLLECTION).updateOne(
    { workspace_id },
    {
      $set: { planner: merged, updated_at: now },
      $setOnInsert: {
        workspace_id,
        created_at: now,
        features: emptyFeatureMap(catalog),
      },
    },
    { upsert: true },
  )
  return getConfig(workspace_id)
}

export async function serialize(doc) {
  if (!doc) return null
  return {
    workspace_id: doc.workspace_id,
    features: await mergeFeatures(doc.workspace_id, doc.features),
    planner: await mergePlanner(doc.workspace_id, doc.planner),
    updated_at: doc.updated_at,
  }
}
