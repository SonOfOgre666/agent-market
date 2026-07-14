'use client'

import { CheckCircle2, Circle, Loader2, XCircle, SkipForward, ShieldAlert } from 'lucide-react'
import { stepDetailLabel } from './stepDetail.js'
import { resolveStepStatus } from './workflowUi.js'
import { useWorkspaceSettings } from '../../components/WorkspaceSettingsProvider.js'

const ICON = {
  completed: CheckCircle2,
  running: Loader2,
  failed: XCircle,
  skipped: SkipForward,
  pending: Circle,
}

export default function WorkflowTimeline({ workflow, busy = false }) {
  const { formatDateTime } = useWorkspaceSettings()
  const graph = workflow?.graph || {}
  const steps = graph.steps || []
  const stepResults = workflow?.step_results || {}

  if (!steps.length) return null

  return (
    <div className="agent-timeline" aria-label="Workflow steps">
      {steps.map((step, idx) => {
        const { status, error, result } = resolveStepStatus({
          step,
          stepResults,
          workflowStatus: workflow?.status,
          busy,
          steps,
        })
        const Icon = ICON[status] || Circle
        const spinning = status === 'running'
        const detail = stepDetailLabel(step, { formatDateTime })

        return (
          <div key={step.step_id} className={`agent-timeline-item agent-timeline-item--${status}`}>
            <div className="agent-timeline-rail">
              {idx > 0 && <span className="agent-timeline-line" />}
              <span className={`agent-timeline-dot${spinning ? ' spin' : ''}`}>
                <Icon size={14} />
              </span>
            </div>
            <div className="agent-timeline-body">
              <div className="agent-timeline-label">
                <code>{step.tool_id}</code>
                {step.requires_approval && (
                  <ShieldAlert size={12} className="agent-wf-approval-icon" aria-label="Requires approval" />
                )}
              </div>
              {detail && <p className="agent-timeline-detail">{detail}</p>}
              {error && (
                <p className="agent-timeline-error">{error}</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
