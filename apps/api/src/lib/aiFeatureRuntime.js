import * as Integration from '../models/Integration.js'
import * as AiWorkspaceConfig from '../models/AiWorkspaceConfig.js'
import { getCatalog, resolveApiModelId } from '../models/AiCatalog.js'
import { resolveApiKey, isOllamaConfigured } from './aiProviderConfig.js'
import { providerStatusFromKey } from './aiProviderTest.js'

export const OPCODE_TO_FEATURE = {
  generate_post: 'post_generation',
  generate_image: 'image_generation',
  generate_video: 'video_generation',
  generate_image_script: 'image_script',
  generate_video_script: 'video_script',
  generate_script: 'video_script',
  analyze_comment: 'comment_analysis',
  content_calendar_suggestions: 'content_calendar',
  seo_keyword_clusters: 'google_search_marketing',
  landing_page_plan: 'landing_page_copy',
}

export async function getFeatureAssignment(workspace_id, featureId) {
  const config = await AiWorkspaceConfig.getConfig(workspace_id)
  return config.features[featureId] || null
}

/** Workspace selection + catalog API model id (for worker execution). */
export async function getRuntimeFeatureAssignment(workspace_id, featureId) {
  const row = await getFeatureAssignment(workspace_id, featureId)
  if (!row?.provider || !row?.model) return null
  const catalog = await getCatalog()
  return {
    provider: row.provider,
    model: row.model,
    api_model_id: resolveApiModelId(catalog, {
      featureId,
      providerId: row.provider,
      modelId: row.model,
    }),
  }
}

export async function getRuntimePlannerAssignment(workspace_id) {
  const config = await AiWorkspaceConfig.getConfig(workspace_id)
  const row = config.planner
  if (!row?.provider || !row?.model) return null
  const catalog = await getCatalog()
  return {
    provider: row.provider,
    model: row.model,
    max_workflow_steps: row.max_workflow_steps,
    api_model_id: resolveApiModelId(catalog, {
      providerId: row.provider,
      modelId: row.model,
      planner: true,
    }),
  }
}

export async function getAssignmentForOpcode(workspace_id, opcode) {
  const featureId = OPCODE_TO_FEATURE[opcode]
  if (!featureId) return null
  return getRuntimeFeatureAssignment(workspace_id, featureId)
}

export async function isProviderUsable(provider, workspace_id) {
  if (provider === 'ollama') {
    if (!(await isOllamaConfigured(workspace_id))) return false
    const row = await Integration.findByName('ollama', workspace_id)
    return providerStatusFromKey(true, row?.test_status) === 'connected'
  }
  const key = await resolveApiKey(provider, workspace_id)
  if (!key) return false
  const row = await Integration.findByName(provider, workspace_id)
  return providerStatusFromKey(true, row?.test_status) === 'connected'
}

export async function isFeatureConfigured(workspace_id, featureId) {
  const assignment = await getFeatureAssignment(workspace_id, featureId)
  if (!assignment?.provider) return false
  return isProviderUsable(assignment.provider, workspace_id)
}

export async function isOpcodeConfigured(workspace_id, opcode) {
  const featureId = OPCODE_TO_FEATURE[opcode]
  if (!featureId) return false
  return isFeatureConfigured(workspace_id, featureId)
}

export async function isPlannerConfigured(workspace_id) {
  const config = await AiWorkspaceConfig.getConfig(workspace_id)
  const provider = config.planner?.provider
  if (!provider) return false
  return isProviderUsable(provider, workspace_id)
}
