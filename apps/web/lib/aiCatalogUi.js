/** UI helpers — catalog must come from API (`GET /ai/workspace` → `catalog`). */

export function modelsForFeature(catalog, featureId, providerId) {
  const rows = catalog?.models_by_provider_feature?.[featureId]?.[providerId] || []
  return rows.map(m => (typeof m === 'string' ? { id: m, label: m } : m))
}

export function modelLabel(catalog, modelId) {
  return catalog?.model_labels?.[modelId] || modelId
}

export function providerOptionLabel(catalog, providerId, configuredIds) {
  const label = catalog?.provider_labels?.[providerId] || providerId
  if (configuredIds?.includes(providerId)) return label
  return `${label} (Not Configured)`
}

export function statusLabel(status) {
  if (status === 'connected') return 'Connected'
  if (status === 'invalid_key') return 'Invalid Key'
  return 'Not Configured'
}

export function plannerModels(catalog, providerId) {
  return catalog?.planner_models_by_provider?.[providerId] || []
}
