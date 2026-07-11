import { authenticate } from '../middleware/auth.js'
import { isOpcodeConfigured } from '../lib/aiFeatureRuntime.js'
import { enqueueGeminiJob, getGeminiJob } from '../lib/aiCeleryBridge.js'

const AI_NOT_CONFIGURED =
  'This AI feature is not configured. Open AI Integrations, connect the provider, and test the API key.'

export default async function aiRoutes(fastify) {
  fastify.get('/ai/jobs/:jobId', { onRequest: [authenticate] }, async (request, reply) => {
    const jobId = decodeURIComponent(request.params.jobId || '')
    const out = await getGeminiJob(jobId, { userId: request.user?.id })
    if (out.statusCode) {
      return reply.code(out.statusCode).send({ error: out.error || 'Job error' })
    }
    if (out.status === 'pending') {
      return reply.send({ status: 'pending' })
    }
    if (out.status === 'complete' && out.ok) {
      return reply.send({ status: 'complete', ok: true, data: out.data })
    }
    return reply.code(out.httpStatus || 502).send({
      status: 'complete',
      ok: false,
      error: out.error || 'AI task failed',
    })
  })

  fastify.post('/ai/generate-post', { onRequest: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    if (!(await isOpcodeConfigured(wid, 'generate_post'))) {
      return reply.code(500).send({ error: AI_NOT_CONFIGURED })
    }
    const { post_type = 'image', prompt, goal = 'engagement', tone = 'friendly', language = 'auto' } = request.body
    if (!prompt?.trim()) {
      return reply.code(400).send({ error: 'Prompt is required' })
    }
    try {
      const { job_id } = await enqueueGeminiJob(
        'generate_post',
        { post_type, prompt, goal, tone, language },
        { userId: request.user?.id, workspaceId: wid },
      )
      return reply.code(202).send({ status: 'pending', job_id })
    } catch (err) {
      const code = err.statusCode || 502
      fastify.log.error(err, 'AI generate-post enqueue error')
      return reply.code(code).send({ error: err.message })
    }
  })

  fastify.post('/ai/generate-image-script', { onRequest: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    if (!(await isOpcodeConfigured(wid, 'generate_image_script'))) {
      return reply.code(500).send({ error: AI_NOT_CONFIGURED })
    }
    const {
      caption, hashtags, hooks, ctas, prompt,
      platform = 'instagram', post_type = 'image',
      goal = 'engagement', tone = 'friendly', language = 'auto',
    } = request.body || {}
    if (!(caption || '').trim() && !(prompt || '').trim()) {
      return reply.code(400).send({ error: 'caption (from generate_post) or prompt is required' })
    }
    try {
      const { job_id } = await enqueueGeminiJob(
        'generate_image_script',
        { caption, hashtags, hooks, ctas, prompt, platform, post_type, goal, tone, language },
        { userId: request.user?.id, workspaceId: wid },
      )
      return reply.code(202).send({ status: 'pending', job_id })
    } catch (err) {
      const code = err.statusCode || 502
      fastify.log.error(err, 'AI generate-image-script enqueue error')
      return reply.code(code).send({ error: err.message })
    }
  })

  fastify.post('/ai/generate-video-script', { onRequest: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    if (!(await isOpcodeConfigured(wid, 'generate_video_script'))) {
      return reply.code(500).send({ error: AI_NOT_CONFIGURED })
    }
    const {
      caption, hashtags, hooks, ctas, prompt,
      platform = 'instagram', post_type = 'video',
      goal = 'engagement', tone = 'friendly', language = 'auto',
    } = request.body || {}
    if (!(caption || '').trim() && !(prompt || '').trim()) {
      return reply.code(400).send({ error: 'caption (from generate_post) or prompt is required' })
    }
    try {
      const { job_id } = await enqueueGeminiJob(
        'generate_video_script',
        { caption, hashtags, hooks, ctas, prompt, platform, post_type, goal, tone, language },
        { userId: request.user?.id, workspaceId: wid },
      )
      return reply.code(202).send({ status: 'pending', job_id })
    } catch (err) {
      const code = err.statusCode || 502
      fastify.log.error(err, 'AI generate-video-script enqueue error')
      return reply.code(code).send({ error: err.message })
    }
  })

  /** @deprecated use /ai/generate-video-script */
  fastify.post('/ai/generate-script', { onRequest: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    if (!(await isOpcodeConfigured(wid, 'generate_video_script'))) {
      return reply.code(500).send({ error: AI_NOT_CONFIGURED })
    }
    const body = request.body || {}
    if (!(body.caption || '').trim() && !(body.prompt || '').trim()) {
      return reply.code(400).send({ error: 'caption (from generate_post) or prompt is required' })
    }
    try {
      const { job_id } = await enqueueGeminiJob(
        'generate_video_script',
        body,
        { userId: request.user?.id, workspaceId: wid },
      )
      return reply.code(202).send({ status: 'pending', job_id })
    } catch (err) {
      const code = err.statusCode || 502
      fastify.log.error(err, 'AI generate-script enqueue error')
      return reply.code(code).send({ error: err.message })
    }
  })

  fastify.post('/ai/generate-image', { onRequest: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    if (!(await isOpcodeConfigured(wid, 'generate_image'))) {
      return reply.code(500).send({ error: AI_NOT_CONFIGURED })
    }
    const { prompt, style = 'realistic', purpose = 'social_post' } = request.body || {}
    if (!prompt?.trim()) {
      return reply.code(400).send({ error: 'prompt (from generate_image_script) is required' })
    }
    try {
      const { job_id } = await enqueueGeminiJob(
        'generate_image',
        { prompt, style, purpose },
        { userId: request.user?.id, workspaceId: wid },
      )
      return reply.code(202).send({ status: 'pending', job_id })
    } catch (err) {
      const code = err.statusCode || 502
      fastify.log.error(err, 'AI generate-image enqueue error')
      return reply.code(code).send({ error: err.message })
    }
  })

  fastify.post('/ai/generate-video', { onRequest: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    if (!(await isOpcodeConfigured(wid, 'generate_video'))) {
      return reply.code(500).send({ error: AI_NOT_CONFIGURED })
    }
    const { prompt, video_prompt, style = 'cinematic' } = request.body || {}
    const videoText = (video_prompt || prompt || '').trim()
    if (!videoText) {
      return reply.code(400).send({ error: 'video_prompt (from generate_video_script) or prompt is required' })
    }
    try {
      const { job_id } = await enqueueGeminiJob(
        'generate_video',
        { prompt: videoText, video_prompt: videoText, style },
        { userId: request.user?.id, workspaceId: wid },
      )
      return reply.code(202).send({ status: 'pending', job_id })
    } catch (err) {
      const code = err.statusCode || 502
      fastify.log.error(err, 'AI generate-video enqueue error')
      return reply.code(code).send({ error: err.message })
    }
  })

  fastify.post('/ai/plan-landing-page', { onRequest: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    if (!(await isOpcodeConfigured(wid, 'landing_page_plan'))) {
      return reply.code(500).send({ error: AI_NOT_CONFIGURED })
    }
    const { prompt, follow_up_answers } = request.body || {}
    if (!prompt?.trim()) {
      return reply.code(400).send({ error: 'prompt is required' })
    }
    try {
      const { job_id } = await enqueueGeminiJob(
        'landing_page_plan',
        { prompt: prompt.trim(), follow_up_answers: follow_up_answers || {} },
        { userId: request.user?.id, workspaceId: wid },
      )
      return reply.code(202).send({ status: 'pending', job_id })
    } catch (err) {
      const code = err.statusCode || 502
      fastify.log.error(err, 'AI plan-landing-page enqueue error')
      return reply.code(code).send({ error: err.message })
    }
  })
}
