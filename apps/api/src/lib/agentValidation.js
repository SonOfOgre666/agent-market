import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REGISTRY_PATH = path.resolve(__dirname, '../../../../services/ai-worker/registry/tools.json')

let _registry = null

function loadRegistry() {
  if (!_registry) {
    _registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'))
  }
  return _registry
}

export function getRegistryToolIds() {
  return (loadRegistry().tools || []).map(t => t.tool_id)
}

/** Stage B — API request validation before enqueue. */
export function validateChatRequest({ message, workspace_id, attachments }) {
  if (!workspace_id) {
    return { ok: false, statusCode: 403, error: 'No workspace selected' }
  }
  const text = (message || '').trim()
  const media = Array.isArray(attachments) ? attachments : []
  if (!text && !media.length) {
    return { ok: false, statusCode: 400, error: 'message or attachments required' }
  }
  if (text.length > 8000) {
    return { ok: false, statusCode: 400, error: 'message exceeds 8000 characters' }
  }
  if (media.length > 4) {
    return { ok: false, statusCode: 400, error: 'At most 4 media attachments per message' }
  }
  return { ok: true }
}

/** Stage C — pre-execution / approval guards. */
export function validateWorkflowExecution(workflow, { action = 'execute' } = {}) {
  if (!workflow) {
    return { ok: false, statusCode: 404, error: 'Workflow not found' }
  }

  const graph = workflow.graph || {}
  const steps = graph.steps || []
  const requiresApproval = Boolean(graph.requires_approval || (workflow.approval_gates || []).length)

  if (action === 'approve') {
    if (!['awaiting_approval', 'planned', 'approved'].includes(workflow.status)) {
      return { ok: false, statusCode: 400, error: `Cannot approve workflow in status: ${workflow.status}` }
    }
    return { ok: true }
  }

  if (action === 'execute') {
    if (requiresApproval && workflow.status !== 'approved') {
      return { ok: false, statusCode: 400, error: 'Workflow requires approval before execution' }
    }
    if (!['planned', 'approved'].includes(workflow.status)) {
      return { ok: false, statusCode: 400, error: `Cannot execute workflow in status: ${workflow.status}` }
    }
    if (!steps.length) {
      return { ok: false, statusCode: 400, error: 'Workflow has no executable steps' }
    }
    return { ok: true }
  }

  if (action === 'reject') {
    if (['completed', 'cancelled'].includes(workflow.status)) {
      return { ok: false, statusCode: 400, error: `Cannot reject workflow in status: ${workflow.status}` }
    }
    return { ok: true }
  }

  if (action === 'cancel') {
    if (['completed', 'cancelled', 'failed'].includes(workflow.status)) {
      return { ok: false, statusCode: 400, error: `Cannot stop workflow in status: ${workflow.status}` }
    }
    return { ok: true }
  }

  return { ok: true }
}

/** Validate planned graph tool IDs against registry (Stage B extension). */
export function validatePlannedGraph(graph) {
  if (!graph || typeof graph !== 'object') {
    return { ok: false, error: 'Invalid workflow graph' }
  }
  const allowed = new Set(getRegistryToolIds())
  for (const step of graph.steps || []) {
    if (!allowed.has(step.tool_id)) {
      return { ok: false, error: `Unknown tool in plan: ${step.tool_id}` }
    }
  }
  return { ok: true }
}

/** Conversational reply with no executable steps — hide workflow card in UI. */
export function isChatOnlyWorkflow(workflow) {
  const graph = workflow?.graph || {}
  if (graph.chat_only) return true
  const steps = graph.steps || []
  const intent = graph.intent || workflow?.intent
  if (intent !== 'informational' || steps.length > 0 || graph.requires_approval) return false
  if (graph.google_setup_phase || graph.meta_setup_phase) return false
  if (graph.google_compiled || graph.meta_compiled) return false
  if (graph.collection_phase) return false
  if (Array.isArray(graph.execute_plan) && graph.execute_plan.length > 0) return false
  return true
}

/** Collecting missing fields — hide workflow card until review. */
export function isCollectionPhaseWorkflow(workflow) {
  const graph = workflow?.graph || {}
  if (graph.collection_phase) return true
  const steps = graph.steps || []
  if (steps.length > 0) return false
  const phase = graph.google_setup_phase || graph.meta_setup_phase
  if (phase === 'discovery') return true
  const summary = String(workflow?.summary || graph.summary || '').toLowerCase()
  if (summary.includes('collect campaign details') || summary.includes('collect google campaign details')) {
    return true
  }
  if (Array.isArray(graph.execute_plan) && graph.execute_plan.length > 0 && !graph.requires_approval) {
    return phase !== 'ready_for_review'
  }
  return false
}

export function shouldShowWorkflowCard(workflow) {
  if (!workflow) return false
  if (isChatOnlyWorkflow(workflow) || isCollectionPhaseWorkflow(workflow)) return false

  const graph = workflow.graph || {}
  const status = workflow.status || ''
  const steps = graph.steps || []

  if (graph.requires_approval && status === 'awaiting_approval') return true
  if (graph.google_setup_phase === 'ready_for_review' || graph.meta_setup_phase === 'ready_for_review') {
    return true
  }

  if (
    steps.length > 0
    && ['running', 'queued', 'approved', 'planned', 'completed', 'failed'].includes(status)
  ) {
    return true
  }

  return false
}
