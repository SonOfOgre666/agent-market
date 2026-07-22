'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { normalizeStepResults } from './workflowUi.js'
import { stepDetailLabel } from './stepDetail.js'

function campaignListSummary(output) {
  const rows = Array.isArray(output?.data)
    ? output.data
    : Array.isArray(output?.campaigns)
      ? output.campaigns
      : Array.isArray(output)
        ? output
        : null
  if (!rows) return null
  const names = rows
    .map((r) => r?.name || r?.campaign_name)
    .filter(Boolean)
    .slice(0, 8)
  const extra = rows.length > names.length ? ` (+${rows.length - names.length} more)` : ''
  if (!names.length) return `${rows.length} campaign${rows.length === 1 ? '' : 's'}`
  return `${rows.length} campaign${rows.length === 1 ? '' : 's'}: ${names.join(', ')}${extra}`
}

function formatOutput(toolId, output) {
  if (output == null) return null
  if (toolId === 'meta_list_campaigns' || toolId === 'google_list_campaigns') {
    const summary = campaignListSummary(output)
    if (summary) return summary
  }
  if (typeof output === 'string') return output
  try {
    return JSON.stringify(output, null, 2)
  } catch {
    return String(output)
  }
}

export default function StepResultViewer({ workflow }) {
  const [open, setOpen] = useState(false)
  const results = normalizeStepResults(workflow?.step_results, workflow?.status)
  const entries = Object.entries(results)
  const steps = workflow?.graph?.steps || []

  if (!entries.length) return null

  return (
    <div className="agent-results">
      <button
        type="button"
        className="agent-results-toggle"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        Step outputs ({entries.length})
      </button>
      {open && (
        <div className="agent-results-body">
          {entries.map(([stepId, result]) => {
            const step = steps.find((s) => s.step_id === stepId)
            const toolId = result.tool_id || step?.tool_id
            const label = stepDetailLabel(step || { tool_id: toolId }) || toolId || stepId
            const formatted = formatOutput(toolId, result.output)
            const isJson = formatted && formatted.trim().startsWith('{')
            return (
              <details key={stepId} className="agent-results-step">
                <summary>
                  <span className="agent-results-label">{label}</span>
                  <span className={`badge badge-sm agent-wf-status agent-wf-status--${result.status}`}>
                    {result.status}
                  </span>
                </summary>
                {formatted != null && (
                  isJson
                    ? <pre className="agent-results-pre">{formatted}</pre>
                    : <p className="agent-results-plain">{formatted}</p>
                )}
                {result.error && (
                  <p className="agent-timeline-error">{result.error}</p>
                )}
              </details>
            )
          })}
        </div>
      )}
    </div>
  )
}
