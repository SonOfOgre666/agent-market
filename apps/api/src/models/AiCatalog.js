import { getDb } from '../lib/mongo.js'
import {
  AI_CATALOG_ID,
  buildAiCatalogSeedDocument,
  catalogNeedsSync,
  syncCatalogWithSeed,
} from '../lib/aiCatalogSeed.js'

export const COLLECTION = 'ai_catalog'

let cachedCatalog = null
let cacheAt = 0
const CACHE_MS = 30_000

export async function seedCatalogIfMissing() {
  const db = getDb()
  const existing = await db.collection(COLLECTION).findOne({ _id: AI_CATALOG_ID })
  if (!existing) {
    const doc = buildAiCatalogSeedDocument()
    await db.collection(COLLECTION).insertOne(doc)
    return doc
  }

  const synced = syncCatalogWithSeed(existing)
  if (catalogNeedsSync(existing, synced)) {
    await db.collection(COLLECTION).replaceOne({ _id: AI_CATALOG_ID }, synced)
    return synced
  }
  return synced
}

export async function getCatalog({ fresh = false } = {}) {
  if (!fresh && cachedCatalog && Date.now() - cacheAt < CACHE_MS) {
    return cachedCatalog
  }
  const doc = await getDb().collection(COLLECTION).findOne({ _id: AI_CATALOG_ID })
  if (!doc) {
    const seeded = await seedCatalogIfMissing()
    cachedCatalog = seeded
    cacheAt = Date.now()
    return seeded
  }
  const synced = syncCatalogWithSeed(doc)
  if (catalogNeedsSync(doc, synced)) {
    await getDb().collection(COLLECTION).replaceOne({ _id: AI_CATALOG_ID }, synced)
    cachedCatalog = synced
  } else {
    cachedCatalog = synced
  }
  cacheAt = Date.now()
  return cachedCatalog
}

export function invalidateCatalogCache() {
  cachedCatalog = null
  cacheAt = 0
}

/** UI / API-friendly maps derived from DB catalog. */
export function catalogViews(catalog) {
  const models_by_provider_feature = {}
  const model_labels = {}
  const api_model_by_selection = {}

  for (const m of catalog.models || []) {
    if (!m.feature_id || m.feature_id === 'planner') continue
    if (!models_by_provider_feature[m.feature_id]) models_by_provider_feature[m.feature_id] = {}
    if (!models_by_provider_feature[m.feature_id][m.provider_id]) {
      models_by_provider_feature[m.feature_id][m.provider_id] = []
    }
    models_by_provider_feature[m.feature_id][m.provider_id].push({
      id: m.model_id,
      label: m.label || m.model_id,
      api_model_id: m.api_model_id || m.model_id,
    })
    model_labels[m.model_id] = m.label || m.model_id
    api_model_by_selection[`${m.feature_id}:${m.provider_id}:${m.model_id}`] =
      m.api_model_id || m.model_id
  }

  const planner_models_by_provider = {}
  const planner_api_model_by_selection = {}
  for (const m of catalog.planner?.models || []) {
    if (!planner_models_by_provider[m.provider_id]) planner_models_by_provider[m.provider_id] = []
    planner_models_by_provider[m.provider_id].push({
      id: m.model_id,
      label: m.label || m.model_id,
      api_model_id: m.api_model_id || m.model_id,
    })
    planner_api_model_by_selection[`${m.provider_id}:${m.model_id}`] = m.api_model_id || m.model_id
  }

  return {
    provider_ids: catalog.provider_ids || [],
    provider_labels: catalog.provider_labels || {},
    feature_ids: catalog.feature_ids || [],
    feature_labels: catalog.feature_labels || {},
    providers_for_feature: catalog.providers_for_feature || {},
    models_by_provider_feature,
    planner_models_by_provider,
    planner_provider_ids: catalog.planner?.provider_ids || catalog.provider_ids || [],
    model_labels,
    api_model_by_selection,
    planner_api_model_by_selection,
    defaults: catalog.defaults || { features: {} },
    planner_defaults: catalog.planner?.defaults || {},
  }
}

function findCatalogModelRow(catalog, { featureId, providerId, modelId, planner = false }) {
  if (planner) {
    return (catalog.planner?.models || []).find(
      m => m.provider_id === providerId && m.model_id === modelId,
    )
  }
  return (catalog.models || []).find(
    m => m.feature_id === featureId && m.provider_id === providerId && m.model_id === modelId,
  )
}

function assertCatalogModelIdsMatch(row) {
  if (!row) return null
  const api = row.api_model_id || row.model_id
  if (api !== row.model_id) {
    return (
      `Catalog entry "${row.model_id}" is misconfigured (api_model_id=${api}). `
      + 'model_id and api_model_id must match.'
    )
  }
  return null
}

export function resolveApiModelId(catalog, { featureId, providerId, modelId, planner = false }) {
  const row = findCatalogModelRow(catalog, { featureId, providerId, modelId, planner })
  if (row) return row.api_model_id || row.model_id
  return modelId
}

export async function validateFeatureAssignment(featureId, provider, model, workspace_id = null) {
  const catalog = await getCatalog()
  const v = workspace_id
    ? await (await import('../lib/aiCatalogWorkspace.js')).getWorkspaceCatalogViews(workspace_id)
    : catalogViews(catalog)
  if (!v.feature_ids.includes(featureId)) return `Unknown feature: ${featureId}`
  if (!v.provider_ids.includes(provider)) return `Unknown provider: ${provider}`
  if (!(v.providers_for_feature[featureId] || []).includes(provider)) {
    return `${v.provider_labels[provider] || provider} does not support ${v.feature_labels[featureId] || featureId}`
  }
  const models = (v.models_by_provider_feature[featureId]?.[provider] || []).map(m => m.id)
  if (provider === 'ollama') {
    if (!models.length) {
      return 'No Ollama models loaded — save and test your Ollama server to fetch installed models'
    }
    if (!models.includes(model)) {
      return `Model "${model}" is not installed on Ollama — available: ${models.join(', ')}`
    }
    return null
  }
  if (!models.includes(model)) return `Invalid model ${model} for ${provider} / ${featureId}`
  const row = findCatalogModelRow(catalog, { featureId, providerId: provider, modelId: model })
  return assertCatalogModelIdsMatch(row)
}

export async function validatePlannerAssignment(provider, model, maxWorkflowSteps, workspace_id = null) {
  const catalog = await getCatalog()
  const v = workspace_id
    ? await (await import('../lib/aiCatalogWorkspace.js')).getWorkspaceCatalogViews(workspace_id)
    : catalogViews(catalog)
  if (!v.planner_provider_ids.includes(provider)) return `Unknown planner provider: ${provider}`
  const models = (v.planner_models_by_provider[provider] || []).map(m => m.id)
  if (provider === 'ollama') {
    if (!models.length) {
      return 'No Ollama models loaded — save and test your Ollama server to fetch installed models'
    }
    if (!models.includes(model)) {
      return `Model "${model}" is not installed on Ollama — available: ${models.join(', ')}`
    }
  } else if (!models.includes(model)) {
    return `Invalid planner model: ${model}`
  }
  const row = findCatalogModelRow(catalog, { providerId: provider, modelId: model, planner: true })
  const mismatch = provider === 'ollama' ? null : assertCatalogModelIdsMatch(row)
  if (mismatch) return mismatch
  const n = Number(maxWorkflowSteps)
  if (!Number.isFinite(n) || n < 1 || n > 50) return 'max_workflow_steps must be between 1 and 50'
  return null
}

export function getDefaultFeatureConfig(_catalog) {
  return {}
}

export function getDefaultPlannerConfig(catalog) {
  const d = catalogViews(catalog).planner_defaults
  return {
    provider: '',
    model: '',
    max_workflow_steps: Number(d.max_workflow_steps ?? 10),
  }
}
