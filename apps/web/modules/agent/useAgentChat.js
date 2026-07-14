'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { api } from '../../lib/api.js'
import { subscribe } from '../../lib/socket.js'
import { useWorkspaceSettings } from '../../components/WorkspaceSettingsProvider.js'
import { pollAgentJob } from './pollAgentJob.js'
import {
  isTerminalWorkflowStatus,
  mergeWorkflowRefresh,
  findCancellableWorkflow,
  hasWorkerActiveWorkflow,
} from './workflowUi.js'

const MAX_AUTO_APPROVE_DEPTH = 5

function summarizeExecution(workflow) {
  const results = workflow?.step_results || {}
  const entries = Object.entries(results)
  if (!entries.length) return null
  const completed = entries.filter(([, r]) => r.status === 'completed').length
  const failed = entries.filter(([, r]) => r.status === 'failed').length
  const skipped = entries.filter(([, r]) => r.status === 'skipped').length
  const parts = []
  if (completed) parts.push(`${completed} completed`)
  if (failed) parts.push(`${failed} failed`)
  if (skipped) parts.push(`${skipped} skipped`)
  return parts.join(', ')
}

function isStopError(msg) {
  return /stopped by user/i.test(String(msg || ''))
}

function applyStepEvent(workflow, event, data) {
  const stepId = data?.step_id
  if (!stepId || !event?.startsWith('step.')) return workflow

  const prev = workflow.step_results || {}
  let entry = { ...(prev[stepId] || {}), tool_id: data.tool_id || prev[stepId]?.tool_id }

  if (event === 'step.running') {
    entry = { ...entry, status: 'running', tool_id: data.tool_id || entry.tool_id }
  } else if (event === 'step.completed') {
    entry = { ...entry, status: 'completed', tool_id: data.tool_id || entry.tool_id }
    if (data.output !== undefined) entry.output = data.output
  } else if (event === 'step.failed') {
    entry = { ...entry, status: 'failed', error: data.error || 'Step failed' }
  } else if (event === 'step.skipped') {
    entry = {
      ...entry,
      status: 'skipped',
      reason: data.reason || 'skipped',
      error: data.reason || data.error || entry.error,
      tool_id: data.tool_id || entry.tool_id,
    }
  } else {
    return workflow
  }

  const nextStatus =
    event === 'step.running' ? 'running' :
    workflow.status === 'planned' ? 'running' : workflow.status

  return {
    ...workflow,
    status: nextStatus,
    step_results: { ...prev, [stepId]: entry },
  }
}

/**
 * Chat command interface — enqueues via API, polls jobs, never executes locally.
 */
export function useAgentChat({ onToast } = {}) {
  const { settings } = useWorkspaceSettings()
  const autoApprove = settings.agent_auto_approve === true
  const autoApproveRef = useRef(autoApprove)
  autoApproveRef.current = autoApprove

  const [messages, setMessages] = useState([])
  const [conversationId, setConversationId] = useState(null)
  const [workflows, setWorkflows] = useState({})
  const [sending, setSending] = useState(false)
  const [actionBusy, setActionBusy] = useState(null)
  const [executionNote, setExecutionNote] = useState(null)
  const workflowsRef = useRef(workflows)
  const actionBusyRef = useRef(null)
  const activeWorkflowRef = useRef(null)
  const abortRunRef = useRef(false)
  const activeRunRef = useRef(0)
  workflowsRef.current = workflows
  actionBusyRef.current = actionBusy

  const clearRunState = useCallback(() => {
    actionBusyRef.current = null
    activeWorkflowRef.current = null
    setActionBusy(null)
    setExecutionNote(null)
  }, [])

  const shouldAbortPoll = useCallback(() => abortRunRef.current, [])

  const wasStopped = useCallback(({ runId, jobResult } = {}) => {
    if (abortRunRef.current) return true
    if (jobResult?.aborted) return true
    if (isStopError(jobResult?.error)) return true
    if (runId != null && runId !== activeRunRef.current) return true
    return false
  }, [])

  useEffect(() => {
    if (!actionBusy) return
    const w = workflows[actionBusy]
    if (w && isTerminalWorkflowStatus(w.status)) {
      clearRunState()
    }
  }, [workflows, actionBusy, clearRunState])

  const refreshWorkflow = useCallback(async (id) => {
    const { workflow } = await api.agentWorkflow(id)
    setWorkflows(prev => ({
      ...prev,
      [id]: mergeWorkflowRefresh(prev[id], workflow),
    }))
    return workflow
  }, [])

  const reportExecutionOutcome = useCallback((workflow, jobResult) => {
    const summary = summarizeExecution(workflow)
    const errs = workflow?.execution_errors || []

    if (workflow?.status === 'completed') {
      onToast?.success?.(summary ? `Workflow finished: ${summary}` : 'Workflow completed')
    } else if (workflow?.status === 'failed') {
      const partial = workflow?.graph?.steps?.length &&
        Object.values(workflow?.step_results || {}).some(r => r.status === 'completed')
      if (partial) {
        onToast?.info?.(errs[0] || 'Some steps failed — your post may still have been saved or scheduled')
      } else {
        onToast?.error?.(errs[0] || summary || 'Workflow failed')
      }
    } else if (workflow?.status === 'awaiting_approval') {
      onToast?.info?.('Some steps still need approval')
    } else if (jobResult && !jobResult.ok) {
      onToast?.error?.(jobResult.error || 'Workflow execution failed')
    } else {
      onToast?.info?.(`Workflow status: ${workflow?.status || 'updated'}`)
    }
  }, [onToast])

  const pollExecutionJob = useCallback(async (wfId, jobId, runId, { depth = 0 } = {}) => {
    const stepCount = workflowsRef.current[wfId]?.graph?.steps?.length || 0
    setExecutionNote(
      stepCount > 6
        ? 'Running workflow — image/video steps may take several minutes…'
        : 'Running steps (AI generation may take 1–2 min)…',
    )
    actionBusyRef.current = wfId
    activeWorkflowRef.current = wfId
    setActionBusy(wfId)

    const jobResult = await pollAgentJob(jobId, {
      maxWaitMs: stepCount > 6 ? 1_800_000 : 600_000,
      intervalMs: 2000,
      shouldAbort: shouldAbortPoll,
      onTick: () => refreshWorkflow(wfId).catch(() => {}),
    })
    if (wasStopped({ runId, jobResult })) return null

    const workflow = await refreshWorkflow(wfId)
    if (wasStopped({ runId }) || workflow?.status === 'cancelled') return workflow

    if (
      workflow?.status === 'awaiting_approval' &&
      autoApproveRef.current &&
      depth < MAX_AUTO_APPROVE_DEPTH
    ) {
      onToast?.info?.('Auto-approving next step…')
      setExecutionNote('Auto-approved — executing…')
      const start = await api.agentApproveWorkflow(wfId)
      if (wasStopped({ runId }) || !start?.job_id) {
        reportExecutionOutcome(workflow, jobResult)
        return workflow
      }
      return pollExecutionJob(wfId, start.job_id, runId, { depth: depth + 1 })
    }

    reportExecutionOutcome(workflow, jobResult)
    return workflow
  }, [onToast, refreshWorkflow, reportExecutionOutcome, shouldAbortPoll, wasStopped])

  useEffect(() => {
    const unsub = subscribe('events', (data) => {
      const event = data?.event || data
      const mongoId = data?.workflow_mongo_id
      const publicId = data?.workflow_id

      const match = Object.values(workflowsRef.current).find(
        w => w.id === mongoId || w.workflow_id === publicId,
      )
      if (!match?.id) return

      if (event?.startsWith('step.')) {
        setWorkflows(prev => {
          const current = prev[match.id] || match
          if (current.status === 'cancelled') return prev
          return {
            ...prev,
            [match.id]: applyStepEvent(current, event, data),
          }
        })
        if (event === 'step.running') {
          setExecutionNote(`Running: ${data.tool_id || data.step_id || '…'}`)
        }
        refreshWorkflow(match.id).catch(() => {})
        return
      }

      if (
        event?.startsWith('workflow.') ||
        event === 'approval.required' ||
        event === 'approval.granted'
      ) {
        refreshWorkflow(match.id).catch(() => {})
        if (event === 'workflow.running') {
          setWorkflows(prev => {
            const current = prev[match.id] || match
            if (current.status === 'cancelled') return prev
            return {
              ...prev,
              [match.id]: { ...current, status: 'running' },
            }
          })
        }
        if (
          event === 'workflow.completed' ||
          event === 'workflow.failed' ||
          event === 'workflow.cancelled' ||
          event === 'approval.required'
        ) {
          if (match.id === actionBusyRef.current || match.id === activeWorkflowRef.current) {
            clearRunState()
          }
        }
        if (event === 'workflow.cancelled') {
          setWorkflows(prev => ({
            ...prev,
            [match.id]: { ...(prev[match.id] || match), status: 'cancelled' },
          }))
        }
      }
    })
    return () => typeof unsub === 'function' && unsub()
  }, [refreshWorkflow, clearRunState])

  const stopProcessing = useCallback(async (explicitWfId) => {
    const wfId = findCancellableWorkflow(workflowsRef.current, explicitWfId || activeWorkflowRef.current || actionBusyRef.current)
    abortRunRef.current = true
    activeRunRef.current += 1
    setExecutionNote('Stopping…')

    if (wfId) {
      try {
        const res = await api.agentCancelWorkflow(wfId)
        if (res.workflow) {
          setWorkflows(prev => ({ ...prev, [wfId]: res.workflow }))
        }
      } catch (err) {
        onToast?.error?.(err.message || 'Could not stop workflow')
      }
    }

    setSending(false)
    clearRunState()
    onToast?.info?.('Stopped')
  }, [clearRunState, onToast])

  const sendMessage = useCallback(async (text, attachments = []) => {
    const trimmed = text.trim()
    const media = Array.isArray(attachments) ? attachments.filter(a => a?.id) : []
    if ((!trimmed && !media.length) || sending) return

    const runId = ++activeRunRef.current
    abortRunRef.current = false
    setMessages(prev => [...prev, {
      role: 'user',
      content: trimmed || '(attached media)',
      attachments: media.length ? media : undefined,
    }])
    setSending(true)
    setExecutionNote('Planning workflow…')
    try {
      const start = await api.agentChat({
        message: trimmed || 'Use the attached media for this request.',
        conversation_id: conversationId,
        attachments: media.length ? media : undefined,
      })
      if (start.workflow_id) activeWorkflowRef.current = start.workflow_id
      if (wasStopped({ runId })) {
        if (start.workflow_id) {
          try {
            const res = await api.agentCancelWorkflow(start.workflow_id)
            if (res.workflow) {
              setWorkflows(prev => ({ ...prev, [start.workflow_id]: res.workflow }))
            }
          } catch { /* ignore cancel race */ }
        }
        return
      }

      if (start.conversation_id) setConversationId(start.conversation_id)

      if (start.status === 'planning' && start.job_id) {
        const planJob = await pollAgentJob(start.job_id, {
          maxWaitMs: 360000,
          intervalMs: 1000,
          shouldAbort: shouldAbortPoll,
          onTick: start.workflow_id
            ? () => refreshWorkflow(start.workflow_id).catch(() => {})
            : undefined,
        })
        if (wasStopped({ runId, jobResult: planJob })) return

        if (!planJob.ok) {
          throw new Error(planJob.error || 'Planning failed')
        }

        if (start.workflow_id) {
          const fresh = await refreshWorkflow(start.workflow_id).catch(() => null)
          if (fresh?.status === 'cancelled' || wasStopped({ runId })) return
        }

        const planData = planJob.data || {}
        const assistantMessage =
          planData.assistant_message ||
          planData.graph?.assistant_message ||
          planData.graph?.summary ||
          ''

        if (!assistantMessage.trim()) {
          throw new Error('Planning did not return an assistant message')
        }

        const completed = await api.agentChatComplete({
          conversation_id: start.conversation_id,
          workflow_id: start.workflow_id,
          assistant_message: assistantMessage,
        })
        if (wasStopped({ runId })) return

        if (completed.assistant_message) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: completed.assistant_message,
            workflow_id: completed.chat_only ? undefined : completed.workflow?.id,
          }])
        }
        if (completed.workflow && !completed.chat_only) {
          setWorkflows(prev => ({ ...prev, [completed.workflow.id]: completed.workflow }))
          const wfId = completed.workflow.id
          let jobId = completed.job_id || null

          if (!jobId && autoApproveRef.current) {
            if (completed.workflow.status === 'awaiting_approval') {
              setExecutionNote('Auto-approved — executing…')
              onToast?.info?.('Auto-approved — running workflow…')
              const start = await api.agentApproveWorkflow(wfId)
              jobId = start?.job_id || null
            } else if (completed.workflow.status === 'planned') {
              setExecutionNote('Auto-running workflow…')
              onToast?.info?.('Auto-running workflow…')
              const start = await api.agentExecuteWorkflow(wfId)
              jobId = start?.job_id || null
            }
          } else if (completed.auto_approved && jobId) {
            setExecutionNote('Auto-approved — executing…')
            onToast?.info?.('Auto-approved — running workflow…')
          }

          if (jobId && !wasStopped({ runId })) {
            await pollExecutionJob(wfId, jobId, runId)
          }
        }
      }
    } catch (err) {
      if (wasStopped({ runId })) return
      onToast?.error?.(err.message || 'Assistant request failed')
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }])
    } finally {
      if (runId === activeRunRef.current) {
        abortRunRef.current = false
        setSending(false)
        clearRunState()
      }
    }
  }, [conversationId, sending, onToast, refreshWorkflow, shouldAbortPoll, wasStopped, pollExecutionJob, clearRunState])

  const runWorkflowAction = useCallback(async (wfId, action) => {
    const runId = ++activeRunRef.current
    abortRunRef.current = false
    actionBusyRef.current = wfId
    activeWorkflowRef.current = wfId
    setActionBusy(wfId)
    setExecutionNote(
      action === 'approve' ? 'Approved — executing workflow…' :
      action === 'execute' ? 'Executing workflow…' : null,
    )

    setWorkflows(prev => {
      const w = prev[wfId]
      if (!w || action === 'reject') return prev
      return {
        ...prev,
        [wfId]: { ...w, status: action === 'approve' || action === 'execute' ? 'running' : w.status },
      }
    })

    try {
      if (action === 'reject') {
        const res = await api.agentRejectWorkflow(wfId)
        if (res.workflow) setWorkflows(prev => ({ ...prev, [wfId]: res.workflow }))
        onToast?.info?.('Workflow cancelled')
        return
      }

      const start = action === 'approve'
        ? await api.agentApproveWorkflow(wfId)
        : await api.agentExecuteWorkflow(wfId)

      if (start?.job_id) {
        await pollExecutionJob(wfId, start.job_id, runId)
      }
    } catch (err) {
      if (!wasStopped({ runId })) {
        onToast?.error?.(err.message || `${action} failed`)
      }
      await refreshWorkflow(wfId).catch(() => {})
    } finally {
      if (runId === activeRunRef.current) {
        abortRunRef.current = false
        clearRunState()
      }
    }
  }, [onToast, refreshWorkflow, clearRunState, wasStopped, pollExecutionJob])

  const loadConversation = useCallback(async (id) => {
    const { conversation } = await api.agentConversation(id)
    setConversationId(conversation.id)
    setMessages((conversation.messages || []).map(m => ({
      role: m.role,
      content: m.content,
      workflow_id: m.workflow_id,
      attachments: m.attachments,
    })))
    const wfIds = [...new Set((conversation.messages || []).map(m => m.workflow_id).filter(Boolean))]
    const loaded = {}
    await Promise.all(wfIds.map(async (wid) => {
      try {
        const { workflow } = await api.agentWorkflow(wid)
        loaded[wid] = workflow
      } catch { /* ignore */ }
    }))
    setWorkflows(loaded)
  }, [])

  const resetConversation = useCallback(() => {
    setConversationId(null)
    setMessages([])
    setWorkflows({})
    setExecutionNote(null)
  }, [])

  const isProcessing = sending || Boolean(actionBusy) || hasWorkerActiveWorkflow(workflows)

  return {
    messages,
    conversationId,
    workflows,
    sending,
    actionBusy,
    isProcessing,
    executionNote,
    sendMessage,
    stopProcessing,
    runWorkflowAction,
    loadConversation,
    resetConversation,
    refreshWorkflow,
  }
}
