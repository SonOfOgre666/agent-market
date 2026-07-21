import { authenticate } from '../middleware/auth.js'
import * as AgentConversation from '../models/AgentConversation.js'
import * as AgentWorkflow from '../models/AgentWorkflow.js'
import {
  enqueuePlanWorkflow,
  enqueueExecuteWorkflow,
} from '../lib/agentCeleryBridge.js'
import {
  validateChatRequest,
  validateWorkflowExecution,
  validatePlannedGraph,
  isChatOnlyWorkflow,
} from '../lib/agentValidation.js'
import { publishEvent } from '../lib/events.js'
import { cancelWorkflowForWorkspace } from '../lib/workflowCancel.js'
import { maybeAutoApproveAndRun } from '../lib/agentAutoApprove.js'
import * as Media from '../models/Media.js'

export default async function agentRoutes(fastify) {
  fastify.get('/agent/conversations', { onRequest: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const items = await AgentConversation.listRecent(wid, { limit: 30 })
    return reply.send({ conversations: items.map(AgentConversation.serialize) })
  })

  fastify.get('/agent/workflows', { onRequest: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const { limit = 20 } = request.query
    const items = await AgentWorkflow.listRecent(wid, { limit: parseInt(limit, 10) || 20 })
    return reply.send({ workflows: items.map(AgentWorkflow.serialize) })
  })

  fastify.get('/agent/conversations/:id', { onRequest: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const conv = await AgentConversation.findById(request.params.id, wid)
    if (!conv) return reply.code(404).send({ error: 'Conversation not found' })
    return reply.send({ conversation: AgentConversation.serialize(conv) })
  })

  fastify.delete('/agent/conversations/:id', { onRequest: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const conv = await AgentConversation.findById(request.params.id, wid)
    if (!conv) return reply.code(404).send({ error: 'Conversation not found' })
    await AgentWorkflow.deleteByConversationId(conv._id.toString(), wid)
    await AgentConversation.deleteById(request.params.id, wid)
    return reply.code(204).send()
  })

  fastify.get('/agent/workflows/:id', { onRequest: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const wf = await AgentWorkflow.findById(request.params.id, wid)
    if (!wf) return reply.code(404).send({ error: 'Workflow not found' })
    return reply.send({ workflow: AgentWorkflow.serialize(wf) })
  })

  fastify.get('/agent/jobs/:jobId', { onRequest: [authenticate] }, async (request, reply) => {
    const { getAgentJob } = await import('../lib/agentCeleryBridge.js')
    const jobId = decodeURIComponent(request.params.jobId || '')
    const out = await getAgentJob(jobId, {
      userId: request.user?.id,
      workspaceId: request.workspace_id,
    })
    if (out.statusCode) {
      return reply.code(out.statusCode).send({ error: out.error || 'Job error' })
    }
    if (out.status === 'pending') {
      return reply.send({ status: 'pending' })
    }
    if (out.status === 'complete') {
      return reply.send({
        status: 'complete',
        ok: Boolean(out.ok),
        data: out.data ?? null,
        error: out.error || null,
      })
    }
  })

  async function normalizeChatAttachments(raw, workspaceId) {
    if (!Array.isArray(raw) || !raw.length) return []
    const out = []
    for (const item of raw.slice(0, 4)) {
      const id = item?.id ? String(item.id) : ''
      if (!id) continue
      const media = await Media.findById(id)
      if (!media || media.workspace_id !== workspaceId) {
        throw Object.assign(new Error('Invalid or inaccessible media attachment'), { statusCode: 422 })
      }
      if (!Media.ALLOWED_MIME.includes(media.mime_type)) {
        throw Object.assign(new Error(`Unsupported attachment type: ${media.mime_type}`), { statusCode: 422 })
      }
      out.push({
        id: media._id.toString(),
        name: media.name,
        mime_type: media.mime_type,
        url: Media.getPublicUrl(media),
      })
    }
    return out
  }

  /** Command interface — enqueue planner only; client polls GET /agent/jobs/:id */
  fastify.post('/agent/chat', { onRequest: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const userId = request.user?.id
    const { message, conversation_id: conversationId, attachments: rawAttachments } = request.body || {}

    const v = validateChatRequest({ message, workspace_id: wid, attachments: rawAttachments })
    if (!v.ok) return reply.code(v.statusCode).send({ error: v.error })

    let attachedMedia = []
    try {
      attachedMedia = await normalizeChatAttachments(rawAttachments, wid)
    } catch (err) {
      return reply.code(err.statusCode || 422).send({ error: err.message })
    }

    let conversation
    if (conversationId) {
      conversation = await AgentConversation.findById(conversationId, wid)
      if (!conversation) return reply.code(404).send({ error: 'Conversation not found' })
    } else {
      conversation = await AgentConversation.create({
        workspace_id: wid,
        user_id: userId,
        title: message.trim().slice(0, 80),
      })
    }

    const userContent = message?.trim() || 'Use the attached media for this request.'
    await AgentConversation.appendMessage(conversation._id, wid, {
      role: 'user',
      content: userContent,
      attachments: attachedMedia.length ? attachedMedia : undefined,
    })

    const fresh = await AgentConversation.findById(conversation._id, wid)
    const history = (fresh?.messages || conversation.messages || []).map(m => ({
      role: m.role,
      content: m.content,
      attachments: m.attachments?.length ? m.attachments : undefined,
      workflow_id: m.workflow_id || undefined,
    }))

    const workflow = await AgentWorkflow.create({
      workspace_id: wid,
      user_id: userId,
      conversation_id: conversation._id.toString(),
      user_message: userContent,
      attached_media: attachedMedia.length ? attachedMedia : undefined,
      status: AgentWorkflow.WorkflowStatus.PLANNING,
    })

    await publishEvent('workflow.started', {
      workflow_id: workflow.workflow_id,
      workflow_mongo_id: workflow._id.toString(),
      workspace_id: wid,
      conversation_id: conversation._id.toString(),
    })

    try {
      const { job_id } = await enqueuePlanWorkflow({
        workspaceId: wid,
        userId,
        workflowId: workflow._id.toString(),
        userMessage: userContent,
        conversationHistory: history,
        attachedMedia,
      })
      return reply.code(202).send({
        status: 'planning',
        job_id,
        conversation_id: conversation._id.toString(),
        workflow_id: workflow._id.toString(),
      })
    } catch (err) {
      await AgentWorkflow.patch(workflow._id, wid, { status: AgentWorkflow.WorkflowStatus.FAILED })
      const code = err.statusCode || 502
      fastify.log.error(err, 'agent plan enqueue error')
      return reply.code(code).send({ error: err.message })
    }
  })

  /** Persist assistant reply after client polled planner job (worker already saved graph). */
  fastify.post('/agent/chat/complete', { onRequest: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const userId = request.user?.id
    const {
      conversation_id: conversationId,
      workflow_id: workflowId,
      assistant_message: assistantMessage,
    } = request.body || {}

    if (!conversationId || !workflowId || !assistantMessage?.trim()) {
      return reply.code(400).send({ error: 'conversation_id, workflow_id, and assistant_message are required' })
    }

    const wf = await AgentWorkflow.findById(workflowId, wid)
    if (!wf) return reply.code(404).send({ error: 'Workflow not found' })

    const graph = wf.graph || {}
    const graphCheck = validatePlannedGraph(graph)
    if (!graphCheck.ok) {
      return reply.code(422).send({ error: graphCheck.error })
    }

    const chatOnly = isChatOnlyWorkflow({ graph, intent: wf.intent })

    await AgentConversation.appendMessage(conversationId, wid, {
      role: 'assistant',
      content: assistantMessage.trim(),
      ...(chatOnly ? {} : { workflow_id: workflowId }),
    })

    let updated = await AgentWorkflow.findById(workflowId, wid)
    let autoApproved = false
    let jobId = null

    if (!chatOnly) {
      try {
        const auto = await maybeAutoApproveAndRun(updated, { workspaceId: wid, userId })
        updated = auto.workflow || updated
        autoApproved = Boolean(auto.started)
        jobId = auto.job_id || null
      } catch (err) {
        fastify.log.error(err, 'agent auto-approve failed')
      }
    }

    return reply.send({
      conversation_id: conversationId,
      workflow: chatOnly ? null : AgentWorkflow.serialize(updated),
      assistant_message: assistantMessage.trim(),
      requires_approval: chatOnly ? false : Boolean(graph.requires_approval) && !autoApproved,
      chat_only: chatOnly,
      auto_approved: autoApproved,
      job_id: jobId,
    })
  })

  /**
   * Persist the post-execution narrator reply (after tools ran).
   * Message comes from the client (already saved on the workflow by the worker).
   */
  fastify.post('/agent/chat/execution-result', { onRequest: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const {
      conversation_id: conversationId,
      workflow_id: workflowId,
      assistant_message: assistantMessage,
    } = request.body || {}

    if (!conversationId || !workflowId || !assistantMessage?.trim()) {
      return reply.code(400).send({ error: 'conversation_id, workflow_id, and assistant_message are required' })
    }

    const conversation = await AgentConversation.findById(conversationId, wid)
    if (!conversation) return reply.code(404).send({ error: 'Conversation not found' })

    const wf = await AgentWorkflow.findById(workflowId, wid)
    if (!wf) return reply.code(404).send({ error: 'Workflow not found' })

    const msg = assistantMessage.trim()
    const existing = Array.isArray(conversation.messages) ? conversation.messages : []
    const alreadyStored = existing.some(
      (m) => m?.role === 'assistant' && m?.workflow_id === workflowId && m?.content === msg,
    )
    if (!alreadyStored) {
      await AgentConversation.appendMessage(conversationId, wid, {
        role: 'assistant',
        content: msg,
        workflow_id: workflowId,
      })
    }

    return reply.send({
      conversation_id: conversationId,
      workflow_id: workflowId,
      assistant_message: msg,
    })
  })

  fastify.post('/agent/workflows/:id/approve', { onRequest: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const userId = request.user?.id
    const wf = await AgentWorkflow.findById(request.params.id, wid)
    const check = validateWorkflowExecution(wf, { action: 'approve' })
    if (!check.ok) return reply.code(check.statusCode).send({ error: check.error })

    await AgentWorkflow.patch(wf._id, wid, {
      status: AgentWorkflow.WorkflowStatus.APPROVED,
      approved_at: new Date(),
      approved_by: userId,
    })

    await publishEvent('approval.granted', {
      workflow_id: wf.workflow_id,
      workflow_mongo_id: wf._id.toString(),
      workspace_id: wid,
    })

    await AgentWorkflow.patch(wf._id, wid, { status: AgentWorkflow.WorkflowStatus.QUEUED })

    try {
      const { job_id } = await enqueueExecuteWorkflow({
        workspaceId: wid,
        userId,
        workflowId: wf._id.toString(),
        approved: true,
      })
      return reply.code(202).send({ status: 'running', job_id, workflow_id: wf._id.toString() })
    } catch (err) {
      const code = err.statusCode || 502
      return reply.code(code).send({ error: err.message })
    }
  })

  fastify.post('/agent/workflows/:id/execute', { onRequest: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const userId = request.user?.id
    const wf = await AgentWorkflow.findById(request.params.id, wid)
    const check = validateWorkflowExecution(wf, { action: 'execute' })
    if (!check.ok) return reply.code(check.statusCode).send({ error: check.error })

    try {
      const { job_id } = await enqueueExecuteWorkflow({
        workspaceId: wid,
        userId,
        workflowId: wf._id.toString(),
        approved: true,
      })
      return reply.code(202).send({ status: 'running', job_id, workflow_id: wf._id.toString() })
    } catch (err) {
      const code = err.statusCode || 502
      return reply.code(code).send({ error: err.message })
    }
  })

  /** Stop planning or step execution (ChatGPT-style stop). */
  fastify.post('/agent/workflows/:id/cancel', { onRequest: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const wf = await AgentWorkflow.findById(request.params.id, wid)
    const check = validateWorkflowExecution(wf, { action: 'cancel' })
    if (!check.ok) return reply.code(check.statusCode).send({ error: check.error })

    const updated = await cancelWorkflowForWorkspace(wf, wid)
    return reply.send({ workflow: AgentWorkflow.serialize(updated) })
  })

  fastify.post('/agent/workflows/:id/reject', { onRequest: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const wf = await AgentWorkflow.findById(request.params.id, wid)
    const check = validateWorkflowExecution(wf, { action: 'reject' })
    if (!check.ok) return reply.code(check.statusCode).send({ error: check.error })

    await AgentWorkflow.patch(wf._id, wid, { status: AgentWorkflow.WorkflowStatus.CANCELLED })
    await publishEvent('workflow.cancelled', {
      workflow_id: wf.workflow_id,
      workspace_id: wid,
    })
    return reply.send({ workflow: AgentWorkflow.serialize(await AgentWorkflow.findById(wf._id, wid)) })
  })
}
