import * as Integration from '../models/Integration.js'
import { getCatalog, catalogViews } from '../models/AiCatalog.js'

const OLLAMA_TEXT_FEATURES = [
  'post_generation',
  'image_script',
  'video_script',
  'google_search_marketing',
  'meta_ad_marketing',
  'landing_page_copy',
]

function ollamaModelsFromConfig(ollamaCfg = {}) {
  return (ollamaCfg.models || [])
    .map(m => ({
      id: m.id || m.name,
      label: m.label || m.name || m.id,
      api_model_id: m.id || m.name,
    }))
    .filter(m => m.id)
}

/** Inject workspace Ollama models (from /api/tags); never use static catalog seed for Ollama. */
export function mergeOllamaModelsIntoViews(views, ollamaCfg = {}) {
  const models = ollamaModelsFromConfig(ollamaCfg)

  const out = {
    ...views,
    models_by_provider_feature: { ...views.models_by_provider_feature },
    planner_models_by_provider: { ...views.planner_models_by_provider },
    model_labels: { ...views.model_labels },
  }

  for (const featureId of OLLAMA_TEXT_FEATURES) {
    if (!out.models_by_provider_feature[featureId]) {
      out.models_by_provider_feature[featureId] = {}
    }
    out.models_by_provider_feature[featureId] = {
      ...out.models_by_provider_feature[featureId],
      ollama: models,
    }
  }

  out.planner_models_by_provider = {
    ...out.planner_models_by_provider,
    ollama: models,
  }

  for (const row of models) {
    out.model_labels[row.id] = row.label
  }

  return out
}

export async function getWorkspaceCatalogViews(workspace_id) {
  const catalog = await getCatalog()
  const views = catalogViews(catalog)
  const ollamaCfg = await Integration.getDecryptedConfig('ollama', workspace_id)
  return mergeOllamaModelsIntoViews(views, ollamaCfg)
}
