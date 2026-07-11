import { getRedis } from './redis.js'
import * as AgentWorkflow from '../models/AgentWorkflow.js'
import { publishEvent } from './events.js'

const CANCEL_PREFIX = 'agentmarket:workflow_cancel:'
const CANCEL_TTL_SEC = 3600
const STOPPED_MSG = 'Stopped by user.'

function cancelKey(workflowId) {
  return `${CANCEL_PREFIX}${workflowId}`
}

const CANCELLABLE = new Set([
  AgentWorkflow.WorkflowStatus.PLANNING,
  AgentWorkflow.WorkflowStatus.PLANNED,
  AgentWorkflow.WorkflowStatus.AWAITING_APPROVAL,
  AgentWorkflow.WorkflowStatus.APPROVED,
  AgentWorkflow.WorkflowStatus.QUEUED,
  AgentWorkflow.WorkflowStatus.RUNNING,
  AgentWorkflow.WorkflowStatus.PENDING,
])

function finalizeRunningSteps(stepResults) {
  if (!stepResults || typeof stepResults !== 'object') return stepResults
  const out = { ...stepResults }
  for (const [sid, row] of Object.entries(out)) {
    if (row?.status === 'running') {
      out[sid] = { ...row, status: 'failed', error: STOPPED_MSG }
    }
  }
  return out
}

export function isWorkflowCancellable(status) {
  return CANCELLABLE.has(status)
}

/** Request stop — worker checks Redis between steps; UI stops polling immediately. */
export async function cancelWorkflowForWorkspace(workflow, workspaceId) {
  if (!workflow) {
    throw Object.assign(new Error('Workflow not found'), { statusCode: 404 })
  }
  if (!isWorkflowCancellable(workflow.status)) {
    throw Object.assign(
      new Error(`Cannot stop workflow in status: ${workflow.status}`),
      { statusCode: 400 },
    )
  }

  const workflowId = workflow._id.toString()
  const redis = getRedis()
  await redis.setex(cancelKey(workflowId), CANCEL_TTL_SEC, '1')

  const stepResults = finalizeRunningSteps(workflow.step_results)
  const updated = await AgentWorkflow.patch(workflowId, workspaceId, {
    status: AgentWorkflow.WorkflowStatus.CANCELLED,
    step_results: stepResults,
    execution_errors: [...(workflow.execution_errors || []), STOPPED_MSG],
  })

  await publishEvent('workflow.cancelled', {
    workflow_id: workflow.workflow_id,
    workflow_mongo_id: workflowId,
    workspace_id: workspaceId,
  })

  return updated
}
