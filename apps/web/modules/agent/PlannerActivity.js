'use client'

import { Brain, Wrench, ListOrdered, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { resolveStepStatus } from './workflowUi.js'

/**
 * Shows LLM steps during planning and tools planned or executed in the workflow.
 */
export default function PlannerActivity({ graph, workflow, busy = false }) {
  const activity = graph?.activity_log || []
  const executePlan = graph?.execute_plan || []
  const steps = graph?.steps || []
  const stepResults = workflow?.step_results || {}
  const workflowStatus = workflow?.status

  const plannedTools = steps.length
    ? steps.map(s => s.tool_id).filter(Boolean)
    : executePlan

  const executedTools = steps
    .map(step => {
      const { status } = resolveStepStatus({
        step,
        stepResults,
        workflowStatus,
        busy,
      })
      if (status === 'pending' || status === 'skipped') return null
      return { toolId: step.tool_id, status, stepId: step.step_id }
    })
    .filter(Boolean)

  if (!activity.length && !plannedTools.length && !executedTools.length) return null

  return (
    <div className="agent-activity-panel">
      {activity.length > 0 && (
        <div className="agent-activity-section">
          <div className="agent-activity-heading">
            <Brain size={14} aria-hidden />
            <span>Planning activity</span>
          </div>
          <ul className="agent-activity-list">
            {activity.map((row, i) => (
              <li key={`${row.kind}-${row.source || row.tool_id}-${i}`} className="agent-activity-item">
                {row.kind === 'tool' ? (
                  <Wrench size={12} className="agent-activity-icon" aria-hidden />
                ) : (
                  <Brain size={12} className="agent-activity-icon" aria-hidden />
                )}
                <span className="agent-activity-label">{row.label}</span>
                {row.feature && row.kind === 'llm' && (
                  <span className="agent-activity-meta">{row.feature}</span>
                )}
                {row.tool_id && row.kind === 'tool' && (
                  <code className="agent-activity-tool">{row.tool_id}</code>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {executedTools.length > 0 && (
        <div className="agent-activity-section">
          <div className="agent-activity-heading">
            <Wrench size={14} aria-hidden />
            <span>Tools executed</span>
          </div>
          <ul className="agent-activity-tools">
            {executedTools.map(({ toolId, status, stepId }) => {
              const Icon = status === 'completed' ? CheckCircle2
                : status === 'failed' ? XCircle
                  : Loader2
              const spinning = status === 'running'
              return (
                <li key={stepId} className={`agent-activity-item agent-activity-item--${status}`}>
                  <Icon size={12} className={`agent-activity-icon${spinning ? ' spin' : ''}`} aria-hidden />
                  <code>{toolId}</code>
                  <span className="agent-activity-meta">{status}</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {plannedTools.length > 0 && executedTools.length === 0 && (
        <div className="agent-activity-section">
          <div className="agent-activity-heading">
            <ListOrdered size={14} aria-hidden />
            <span>{steps.length ? 'Workflow tools' : 'Tools on approve'}</span>
          </div>
          <ul className="agent-activity-tools">
            {plannedTools.map((toolId, i) => (
              <li key={`${toolId}-${i}`}>
                <code>{toolId}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
