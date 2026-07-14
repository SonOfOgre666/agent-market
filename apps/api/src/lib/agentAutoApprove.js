import * as Setting from '../models/Setting.js'
import * as AgentWorkflow from '../models/AgentWorkflow.js'
import { enqueueExecuteWorkflow } from './agentCeleryBridge.js'
import { publishEvent } from './events.js'
import { validateWorkflowExecution } from './agentValidation.js'

/**
 * When workspace prefers agent auto-approve, approve (if needed) and enqueue execution.
 * @returns {{ workflow: object, started: boolean, job_id?: string }}
 */
export async function maybeAutoApproveAndRun(wf, { workspaceId, userId }) {
  if (!wf) return { workflow: wf, started: false }

  const enabled = await Setting.get('agent_auto_approve', workspaceId)
  if (enabled !== true) return { workflow: wf, started: false }

  const status = wf.status
  if (status === 'awaiting_approval') {
    const check = validateWorkflowExecution(wf, { action: 'approve' })
    if (!check.ok) return { workflow: wf, started: false }

    await AgentWorkflow.patch(wf._id, workspaceId, {
      status: AgentWorkflow.WorkflowStatus.APPROVED,
      approved_at: new Date(),
      approved_by: userId || null,
    })
    await publishEvent('approval.granted', {
      workflow_id: wf.workflow_id,
      workflow_mongo_id: wf._id.toString(),
      workspace_id: workspaceId,
      auto: true,
    })
    await AgentWorkflow.patch(wf._id, workspaceId, { status: AgentWorkflow.WorkflowStatus.QUEUED })
  } else if (status === 'planned') {
    const check = validateWorkflowExecution(wf, { action: 'execute' })
    if (!check.ok) return { workflow: wf, started: false }
  } else {
    return { workflow: wf, started: false }
  }

  const { job_id } = await enqueueExecuteWorkflow({
    workspaceId,
    userId,
    workflowId: wf._id.toString(),
    approved: true,
  })
  const updated = await AgentWorkflow.findById(wf._id, workspaceId)
  return { workflow: updated, started: true, job_id }
}
