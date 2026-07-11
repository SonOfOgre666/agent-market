/**
 * Canonical AI catalog — written to MongoDB `ai_catalog` on API startup.
 *
 * Rules:
 * - model_id === api_model_id (real provider API string; label is display-only).
 * - Catalog lists allowed models per provider/feature — it does NOT assign defaults.
 * - API keys: integrations collection. Provider + model picks: ai_workspace_configs only.
 */

export const AI_CATALOG_ID = 'global'
export const CATALOG_VERSION = 9

/** Old fake UI ids → real API ids (workspace configs may still reference these). */
export const LEGACY_MODEL_REMAP = {
  'gpt-5.5': 'gpt-4o',
  'gpt-4.5-flash': 'gpt-4o-mini',
  'gpt-5': 'gpt-4o',
  'gpt-image-1.5': 'gpt-image-1',
  'veo-3.1': 'veo-3.0-generate-001',
  'veo-3.1-fast': 'veo-3.0-fast-generate-001',
  'veo-3.1-lite': 'veo-3.0-fast-generate-001',
  'veo-3.1-generate-preview': 'veo-3.0-generate-001',
  'veo-3.1-fast-generate-preview': 'veo-3.0-fast-generate-001',
  'claude-opus-4-20250514': 'claude-opus-4-8',
  'claude-sonnet-4-20250514': 'claude-sonnet-4-6',
  'claude-haiku-4-20250514': 'claude-haiku-4-5-20251001',
}

export function remapLegacyModelId(modelId) {
  const id = String(modelId || '').trim()
  return LEGACY_MODEL_REMAP[id] || id
}

/** @param {string} id Official API model id @param {string} [label] UI display name */
function m(id, label) {
  return { id, label: label || id }
}

function toCatalogRow(featureId, providerId, entry) {
  return {
    feature_id: featureId,
    provider_id: providerId,
    model_id: entry.id,
    label: entry.label || entry.id,
    api_model_id: entry.id,
  }
}

export function buildAiCatalogSeedDocument() {
  const provider_ids = ['gemini', 'openai', 'anthropic', 'openrouter', 'ollama']
  const provider_labels = {
    gemini: 'Gemini',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    openrouter: 'OpenRouter',
    ollama: 'Ollama (local)',
  }

  const feature_ids = [
    'post_generation',
    'image_generation',
    'video_generation',
    'image_script',
    'video_script',
    'comment_analysis',
    'content_calendar',
    'google_search_marketing',
    'meta_ad_marketing',
    'landing_page_copy',
  ]

  const feature_labels = {
    post_generation: 'Post Generation',
    image_generation: 'Image Generation',
    video_generation: 'Video Generation',
    image_script: 'Image Script Generation',
    video_script: 'Video Script Generation',
    comment_analysis: 'Comment Analysis',
    content_calendar: 'Content Calendar AI',
    google_search_marketing: 'Google Ads Marketing',
    meta_ad_marketing: 'Meta Ad Marketing',
    landing_page_copy: 'Landing Page Copy',
  }

  const providers_for_feature = {
    post_generation: ['gemini', 'openai', 'anthropic', 'openrouter', 'ollama'],
    image_generation: ['gemini', 'openai'],
    video_generation: ['gemini', 'openai'],
    image_script: ['gemini', 'openai', 'anthropic', 'openrouter', 'ollama'],
    video_script: ['gemini', 'openai', 'anthropic', 'openrouter', 'ollama'],
    comment_analysis: ['gemini', 'openai', 'anthropic', 'openrouter', 'ollama'],
    content_calendar: ['gemini', 'openai', 'anthropic', 'openrouter', 'ollama'],
    google_search_marketing: ['gemini', 'openai', 'anthropic', 'openrouter', 'ollama'],
    meta_ad_marketing: ['gemini', 'openai', 'anthropic', 'openrouter', 'ollama'],
    landing_page_copy: ['gemini', 'openai', 'anthropic', 'openrouter', 'ollama'],
  }

  // OpenAI — developers.openai.com/api/docs/models
  const openaiText = [
    m('gpt-4.1', 'GPT-4.1'),
    m('gpt-4.1-mini', 'GPT-4.1 Mini'),
    m('gpt-4o', 'GPT-4o'),
    m('gpt-4o-mini', 'GPT-4o Mini'),
  ]

  // Gemini — Google Generative Language API (models/* list)
  const geminiText = [
    m('gemini-2.5-flash', 'Gemini 2.5 Flash'),
    m('gemini-2.5-pro', 'Gemini 2.5 Pro'),
    m('gemini-2.5-flash-lite', 'Gemini 2.5 Flash Lite'),
    m('gemini-3.5-flash', 'Gemini 3.5 Flash'),
    m('gemini-3.1-flash-lite', 'Gemini 3.1 Flash Lite'),
    m('gemini-flash-latest', 'Gemini Flash Latest'),
    m('gemini-pro-latest', 'Gemini Pro Latest'),
  ]

  // Anthropic — platform.claude.com/docs/en/about-claude/models/overview
  const anthropicText = [
    m('claude-opus-4-8', 'Claude Opus 4.8'),
    m('claude-sonnet-4-6', 'Claude Sonnet 4.6'),
    m('claude-haiku-4-5-20251001', 'Claude Haiku 4.5'),
  ]

  // OpenRouter — OpenAI-compatible API; text-only (no image/video models here).
  const openrouterText = [
    m('nex-agi/nex-n2-pro:free', 'Nex N2 Pro (free)'),
  ]

  // Ollama models are not seeded — loaded per workspace from GET {base_url}/api/tags after Test/Save.

  const textByProvider = {
    openai: openaiText,
    gemini: geminiText,
    anthropic: anthropicText,
    openrouter: openrouterText,
  }

  const featureModels = []
  const addFeatureModels = (featureId, byProvider) => {
    for (const [providerId, entries] of Object.entries(byProvider)) {
      for (const entry of entries) {
        featureModels.push(toCatalogRow(featureId, providerId, entry))
      }
    }
  }

  for (const featureId of [
    'post_generation',
    'image_script',
    'video_script',
    'comment_analysis',
    'content_calendar',
    'google_search_marketing',
    'meta_ad_marketing',
    'landing_page_copy',
  ]) {
    addFeatureModels(featureId, textByProvider)
  }

  addFeatureModels('image_generation', {
    openai: [
      m('gpt-image-1', 'GPT Image 1'),
      m('gpt-image-1-mini', 'GPT Image 1 Mini'),
    ],
    gemini: [
      m('gemini-3-pro-image', 'Nano Banana Pro'),
      m('gemini-3.1-flash-image', 'Nano Banana 2'),
    ],
  })

  addFeatureModels('video_generation', {
    openai: [
      m('sora-2', 'Sora 2'),
      m('sora-2-pro', 'Sora 2 Pro'),
    ],
    gemini: [
      m('veo-3.0-generate-001', 'Veo 3'),
      m('veo-3.0-fast-generate-001', 'Veo 3 Fast'),
      m('veo-2.0-generate-001', 'Veo 2'),
    ],
  })

  const planner_models = [
    ...openaiText.map(e => toCatalogRow('planner', 'openai', e)),
    ...geminiText.map(e => toCatalogRow('planner', 'gemini', e)),
    ...anthropicText.map(e => toCatalogRow('planner', 'anthropic', e)),
    ...openrouterText.map(e => toCatalogRow('planner', 'openrouter', e)),
  ]

  return {
    _id: AI_CATALOG_ID,
    version: CATALOG_VERSION,
    provider_ids,
    provider_labels,
    feature_ids,
    feature_labels,
    providers_for_feature,
    models: featureModels,
    planner: {
      provider_ids,
      models: planner_models,
      defaults: {
        max_workflow_steps: 10,
      },
    },
    defaults: {
      features: {},
    },
    updated_at: new Date(),
  }
}

function modelListKey(m) {
  return `${m.feature_id}:${m.provider_id}:${m.model_id}`
}

/** True when catalog content differs from canonical seed (triggers one DB write). */
export function catalogNeedsSync(existing, synced) {
  if (!existing) return true
  if ((existing.version || 0) < CATALOG_VERSION) return true

  const fields = [
    'provider_ids',
    'provider_labels',
    'feature_ids',
    'feature_labels',
    'providers_for_feature',
  ]
  for (const f of fields) {
    if (JSON.stringify(existing[f] || null) !== JSON.stringify(synced[f] || null)) return true
  }

  const existingModels = (existing.models || []).map(modelListKey).sort().join('|')
  const syncedModels = (synced.models || []).map(modelListKey).sort().join('|')
  if (existingModels !== syncedModels) return true

  const existingPlanner = (existing.planner?.models || []).map(modelListKey).sort().join('|')
  const syncedPlanner = (synced.planner?.models || []).map(modelListKey).sort().join('|')
  if (existingPlanner !== syncedPlanner) return true

  for (const m of synced.models || []) {
    const row = (existing.models || []).find(
      x => x.feature_id === m.feature_id && x.provider_id === m.provider_id && x.model_id === m.model_id,
    )
    if (!row || row.api_model_id !== m.api_model_id || row.label !== m.label) return true
  }

  return false
}

/**
 * Sync Mongo catalog with canonical seed — replaces model lists (no duplicates),
 * fixes legacy alias rows, preserves workspace default selections when still valid.
 */
export function syncCatalogWithSeed(existing) {
  const seed = buildAiCatalogSeedDocument()
  if (!existing) return seed

  const maxSteps = Number(
    existing.planner?.defaults?.max_workflow_steps ?? 10,
  )

  return {
    ...existing,
    _id: AI_CATALOG_ID,
    version: CATALOG_VERSION,
    provider_ids: seed.provider_ids,
    provider_labels: seed.provider_labels,
    feature_ids: seed.feature_ids,
    feature_labels: seed.feature_labels,
    providers_for_feature: seed.providers_for_feature,
    models: seed.models,
    planner: {
      ...seed.planner,
      defaults: { max_workflow_steps: maxSteps },
    },
    defaults: { features: {} },
    updated_at: new Date(),
  }
}

/** @deprecated Use syncCatalogWithSeed */
export const mergeCatalogWithSeed = syncCatalogWithSeed
