'use client'

import { CheckCircle2, XCircle, Play, ShieldAlert, Loader2, AlertTriangle } from 'lucide-react'
import WorkflowTimeline from './WorkflowTimeline.js'
import StepResultViewer from './StepResultViewer.js'
import PlannerActivity from './PlannerActivity.js'
import { workflowShowsRunning, getPartialSuccessMessage, getActiveStep } from './workflowUi.js'

export default function WorkflowCard({ workflow, busy, onApprove, onExecute, onReject }) {
  const graph = workflow?.graph || {}
  const steps = graph.steps || []
  const status = workflow?.status
  const isRunning = workflowShowsRunning({ busy, status })
  const errors = workflow?.execution_errors || []
  const failedSteps = Object.entries(workflow?.step_results || {})
    .filter(([, r]) => r.status === 'failed')
  const partialMsg = getPartialSuccessMessage(workflow)
  const activeStep = getActiveStep(workflow)

  return (
    <div className="agent-wf-card">
      <div className="agent-wf-card-header">
        <span className="agent-wf-intent">{graph.intent || workflow?.intent || 'plan'}</span>
        <span className={`badge badge-sm agent-wf-status agent-wf-status--${status}`}>{status}</span>
      </div>
      {workflow?.summary && <p className="agent-wf-summary">{workflow.summary}</p>}

      <PlannerActivity graph={graph} workflow={workflow} busy={busy && isRunning} />

      {isRunning && (
        <div className="agent-wf-running" role="status" aria-live="polite">
          <Loader2 size={14} className="spin" aria-hidden />
          <span>
            {activeStep
              ? `Running ${activeStep.toolId}…`
              : 'Executing workflow — generating content and running steps…'}
          </span>
        </div>
      )}

      {status === 'completed' && !partialMsg && (
        <div className="agent-wf-banner agent-wf-banner--success">
          <CheckCircle2 size={14} /> Workflow completed. Expand step outputs below for generated content.
        </div>
      )}

      {partialMsg && (
        <div className="agent-wf-banner agent-wf-banner--warning">
          <AlertTriangle size={14} />
          <span>{partialMsg}</span>
        </div>
      )}

      {status === 'failed' && !partialMsg && (
        <div className="agent-wf-banner agent-wf-banner--error">
          <AlertTriangle size={14} />
          <span>{errors[0] || failedSteps[0]?.[1]?.error || 'Workflow failed'}</span>
        </div>
      )}

      {graph.meta_setup_phase === 'ready_for_review' && status === 'awaiting_approval' && (
        <div className="agent-wf-banner agent-wf-banner--warning">
          <ShieldAlert size={14} />
          <span>Review the campaign details above. Approve to create on Meta (paused by default).</span>
        </div>
      )}

      <WorkflowTimeline workflow={workflow} busy={busy && isRunning} />
      <StepResultViewer workflow={workflow} />

      <div className="agent-wf-actions">
        {status === 'awaiting_approval' && !busy && (
          <>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={onApprove}>
              <CheckCircle2 size={14} />
              {graph.meta_setup_phase === 'ready_for_review' ? 'Approve & create campaign' : 'Approve & run'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onReject}>
              <XCircle size={14} /> Reject
            </button>
          </>
        )}
        {status === 'planned' && steps.length > 0 && !isRunning && (
          <button type="button" className="btn btn-primary btn-sm" disabled={isRunning} onClick={onExecute}>
            <Play size={14} /> Run workflow
          </button>
        )}
        {isRunning && (
          <span className="agent-wf-busy-label">
            <Loader2 size={14} className="spin" aria-hidden /> Working…
          </span>
        )}
      </div>
    </div>
  )
}
