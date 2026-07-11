'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { normalizeStepResults } from './workflowUi.js'

function formatOutput(output) {
  if (output == null) return null
  if (typeof output === 'string') return output
  try {
    return JSON.stringify(output, null, 2)
  } catch {
    return String(output)
  }
}

export default function StepResultViewer({ workflow }) {
  const hasResults = workflow?.step_results && Object.keys(workflow.step_results).length > 0
  const [open, setOpen] = useState(hasResults)
  const results = normalizeStepResults(workflow?.step_results, workflow?.status)
  const entries = Object.entries(results)

  if (!entries.length) return null

  return (
    <div className="agent-results">
      <button
        type="button"
        className="agent-results-toggle"
        onClick={() => setOpen(o => !o)}
      >
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        Step outputs ({entries.length})
      </button>
      {open && (
        <div className="agent-results-body">
          {entries.map(([stepId, result]) => (
            <details key={stepId} className="agent-results-step" open>
              <summary>
                <code>{stepId}</code>
                <span className={`badge badge-sm agent-wf-status agent-wf-status--${result.status}`}>
                  {result.status}
                </span>
              </summary>
              {result.output != null && (
                <pre className="agent-results-pre">{formatOutput(result.output)}</pre>
              )}
              {result.error && (
                <p className="agent-timeline-error">{result.error}</p>
              )}
            </details>
          ))}
        </div>
      )}
    </div>
  )
}
