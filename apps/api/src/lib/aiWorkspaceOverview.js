import * as Integration from '../models/Integration.js'
import * as AiWorkspaceConfig from '../models/AiWorkspaceConfig.js'
import { getWorkspaceCatalogViews } from './aiCatalogWorkspace.js'
import { providerStatusFromKey } from './aiProviderTest.js'

export async function buildAiWorkspaceOverview(workspace_id) {
  const views = await getWorkspaceCatalogViews(workspace_id)
  const config = await AiWorkspaceConfig.getConfig(workspace_id)
  const rows = await Integration.findAll(workspace_id)
  const byName = Object.fromEntries(rows.map(r => [r.name, r]))

  const providers = []
  for (const id of views.provider_ids) {
    const row = byName[id]
    const hasKey = await Integration.hasApiKey(id, workspace_id)
    const entry = {
      id,
      label: views.provider_labels[id] || id,
      status: providerStatusFromKey(hasKey, row?.test_status),
      has_key: hasKey,
      tested_at: row?.tested_at || null,
    }
    if (id === 'ollama') {
      const cfg = await Integration.getDecryptedConfig('ollama', workspace_id)
      entry.connection_hint = (cfg.base_url || '').trim() || null
      entry.model_count = (cfg.models || []).length
    }
    providers.push(entry)
  }

  const configured_provider_ids = providers
    .filter(p => p.status === 'connected')
    .map(p => p.id)

  return {
    providers,
    configured_provider_ids,
    credentials: Object.fromEntries(
      await Promise.all(
        views.provider_ids.map(async id => [id, { has_key: await Integration.hasApiKey(id, workspace_id) }]),
      ),
    ),
    features: config.features,
    planner: config.planner,
    catalog: views,
  }
}

export async function assertFeatureProvidersConfigured(workspace_id, features) {
  const views = await getWorkspaceCatalogViews(workspace_id)
  const warnings = []
  for (const [featureId, assignment] of Object.entries(features || {})) {
    const hasKey = await Integration.hasApiKey(assignment.provider, workspace_id)
    const row = await Integration.findByName(assignment.provider, workspace_id)
    const status = providerStatusFromKey(hasKey, row?.test_status)
    if (!hasKey || status !== 'connected') {
      warnings.push({
        feature_id: featureId,
        provider: assignment.provider,
        message: `${views.provider_labels[assignment.provider] || assignment.provider} is not connected`,
      })
    }
  }
  return warnings
}
