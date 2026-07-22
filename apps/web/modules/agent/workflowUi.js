const INTERRUPTED_MSG = 'Step interrupted — worker stopped before completion.'

const TERMINAL_STEP_STATUSES = new Set(['completed', 'failed', 'skipped'])

const CANCELLABLE_WORKFLOW_STATUSES = new Set([
  'planning', 'planned', 'awaiting_approval', 'approved', 'queued', 'running', 'pending',
])

const WORKER_ACTIVE_STATUSES = new Set(['planning', 'running', 'queued'])

export function isCancellableWorkflowStatus(status) {
  return CANCELLABLE_WORKFLOW_STATUSES.has(status)
}

export function isWorkerActiveWorkflowStatus(status) {
  return WORKER_ACTIVE_STATUSES.has(status)
}

export function findCancellableWorkflow(workflows, preferredId) {
  if (!workflows || typeof workflows !== 'object') return preferredId || null
  if (preferredId && isCancellableWorkflowStatus(workflows[preferredId]?.status)) {
    return preferredId
  }
  const hit = Object.entries(workflows).find(([, w]) => isCancellableWorkflowStatus(w?.status))
  return hit?.[0] || preferredId || null
}

export function hasWorkerActiveWorkflow(workflows) {
  return Object.values(workflows || {}).some((w) => isWorkerActiveWorkflowStatus(w?.status))
}

/** Merge server refresh without downgrading steps the socket already finished. */
export function mergeWorkflowRefresh(local, server) {
  if (!server) return local
  if (!local) return server
  if (local.status === 'cancelled' && server.status === 'running') {
    return local
  }
  const localResults = local.step_results || {}
  const serverResults = server.step_results || {}
  const mergedResults = { ...serverResults }
  let changed = false
  for (const [sid, localRow] of Object.entries(localResults)) {
    const serverRow = serverResults[sid]
    if (
      TERMINAL_STEP_STATUSES.has(localRow?.status)
      && serverRow?.status === 'running'
    ) {
      mergedResults[sid] = localRow
      changed = true
    }
  }
  if (!changed) return server
  return { ...server, step_results: mergedResults }
}

/** Step currently executing on the worker (from persisted step_results). */
export function getActiveStep(workflow) {
  const results = workflow?.step_results || {}
  const hit = Object.entries(results).find(([, r]) => r?.status === 'running')
  if (!hit) return null
  const [stepId, row] = hit
  const step = (workflow?.graph?.steps || []).find(s => s.step_id === stepId)
  return { stepId, toolId: row?.tool_id || step?.tool_id || stepId }
}

/** Terminal workflow statuses — no active execution spinner. */
export function isTerminalWorkflowStatus(status) {
  return ['completed', 'failed', 'cancelled', 'awaiting_approval'].includes(status)
}

/** Stale ``running`` rows after crash/reboot — never show a live spinner. */
export function normalizeStepResults(stepResults, workflowStatus) {
  if (!stepResults || typeof stepResults !== 'object') return stepResults || {}
  if (!isTerminalWorkflowStatus(workflowStatus)) return stepResults

  let changed = false
  const out = { ...stepResults }
  for (const [sid, row] of Object.entries(out)) {
    if (row?.status === 'running') {
      out[sid] = {
        ...row,
        status: 'failed',
        error: row.error || INTERRUPTED_MSG,
      }
      changed = true
    }
  }
  return changed ? out : stepResults
}

/** Effective step status for timeline (handles stale DB + optimistic UI). */
export function resolveStepStatus({ step, stepResults, workflowStatus, busy, steps = null }) {
  const result = stepResults[step.step_id]
  let status = result?.status || 'pending'

  if (isTerminalWorkflowStatus(workflowStatus) && status === 'running') {
    return { status: 'failed', error: result?.error || INTERRUPTED_MSG, result }
  }

  const wfRunning = workflowShowsRunning({ busy, status: workflowStatus })
  if (wfRunning && status === 'pending') {
    const deps = step.depends_on || []
    const depsDone = deps.every((d) => {
      const st = stepResults[d]?.status
      return st === 'completed' || st === 'skipped'
    })
    const anyRunning = Object.values(stepResults).some((r) => r?.status === 'running')
    if (depsDone && !anyRunning) {
      // Only the first ready pending step gets an optimistic spinner — not every unmet step.
      const ordered = Array.isArray(steps) && steps.length ? steps : null
      if (!ordered) {
        status = 'running'
      } else {
        const firstReady = ordered.find((s) => {
          const st = stepResults[s.step_id]?.status
          if (st === 'completed' || st === 'failed' || st === 'skipped' || st === 'running') {
            return false
          }
          const d = s.depends_on || []
          return d.every((dep) => {
            const ds = stepResults[dep]?.status
            return ds === 'completed' || ds === 'skipped'
          })
        })
        if (firstReady?.step_id === step.step_id) status = 'running'
      }
    }
  }

  return { status, error: result?.error, result }
}

export function workflowShowsRunning({ busy, status }) {
  if (isTerminalWorkflowStatus(status)) return false
  return Boolean(busy) || status === 'running' || status === 'queued'
}

/** e.g. image/video skipped (quota) but draft_post still saved; or multi-account analytics */
export function getPartialSuccessMessage(workflow) {
  const graph = workflow?.graph || {}
  const steps = graph.steps || []
  const results = workflow?.step_results || {}
  const wfStatus = workflow?.status
  if (!['failed', 'completed'].includes(wfStatus)) return null

  const optionalSkipped = Object.values(results).filter(
    r => r.status === 'skipped' && r.reason === 'optional_step_failed',
  )
  const failed = Object.entries(results).filter(
    ([, r]) => r.status === 'failed' || (r.status === 'skipped' && r.reason === 'optional_step_failed'),
  )
  if (!failed.length && !optionalSkipped.length) return null

  const anyCompleted = Object.values(results).some(r => r.status === 'completed')
  const intent = graph.intent || workflow?.intent
  if (anyCompleted && failed.length && (intent === 'analytics' || wfStatus === 'completed')) {
    return 'Some steps failed (often a disconnected ads account), but other results came back successfully.'
  }

  const tailTools = ['schedule_post', 'publish_post', 'create_draft_post']
  const lastStep = steps[steps.length - 1]
  const lastOk =
    lastStep &&
    tailTools.includes(lastStep.tool_id) &&
    results[lastStep.step_id]?.status === 'completed'

  if (!lastOk) return null
  if (wfStatus === 'completed' && !optionalSkipped.length) return null

  if (lastStep.tool_id === 'schedule_post') {
    return 'Some steps failed, but your post was saved and scheduled successfully.'
  }
  if (lastStep.tool_id === 'publish_post') {
    return 'Some steps failed, but your post was published successfully.'
  }
  if (lastStep.tool_id === 'create_draft_post') {
    return 'Some steps failed, but your draft post was saved successfully.'
  }
  return null
}

/** Only the first chat message that references a workflow should mount its card. */
export function isPrimaryWorkflowMessage(messages, index) {
  const wid = messages?.[index]?.workflow_id
  if (!wid) return false
  return messages.findIndex((m) => m?.workflow_id === wid) === index
}

/** Prefer short plan summary; hide when it was polluted with the narrator reply. */
export function workflowPlanSummary(workflow) {
  const graph = workflow?.graph || {}
  const summary = String(workflow?.summary || graph.summary || '').trim()
  if (!summary) return null
  const result = String(graph.result_assistant_message || '').trim()
  if (result && summary === result) return null
  if (result && summary.length > 180 && result.length > 40 && summary.includes(result.slice(0, 48))) {
    return null
  }
  return summary
}

/** Collecting missing fields — no workflow card, just the assistant question. */
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

/** Plain chat — no workflow card (greetings, capabilities, informational Q&A). */
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
