import { authenticate } from '../middleware/auth.js'
import * as Post from '../models/Post.js'
import * as Account from '../models/Account.js'
import { dispatchPublishPost } from '../queue/dispatcher.js'
import { assertSocialPublishAccounts, preparePublishPostForWorkspace } from '../services/postCreate.js'
import { enqueueCreateDraftPost, enqueueSchedulePost } from '../services/postSocialEnqueue.js'
import {
  listForPost,
  findByUuid,
  runAnalysisForRecord,
  markReplyPending,
  postCaptionContext,
} from '../services/postComments.js'
import { enqueueCeleryTask } from '../lib/celeryEnqueue.js'

function assertPublishedPost(post) {
  if (post.status !== Post.PostStatus.PUBLISHED) {
    throw Object.assign(new Error('Comments are only available for published posts'), { statusCode: 422 })
  }
}

export default async function postRoutes(app) {
  // GET /api/posts
  app.get('/posts', { preHandler: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const { status, keyword, account_id, page = 1, per_page = 15 } = request.query
    const result = await Post.findAll({ workspace_id: wid, status, keyword, account_id, page: parseInt(page), per_page: parseInt(per_page) })
    const publishSummaries = await Post.findPublishSummaries(result.items.map(p => p._id.toString()))
    return reply.send({
      ...result,
      items: result.items.map((post) => {
        const serialized = Post.serialize(post)
        return {
          ...serialized,
          publish_summary: publishSummaries[serialized.id] || { total: 0, succeeded: 0, failed: 0, partial: false },
        }
      }),
    })
  })

  // GET /api/posts/:id
  app.get('/posts/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const post = await Post.findByUuid(request.params.id, wid) || await Post.findById(request.params.id, wid)
    if (!post) return reply.code(404).send({ error: 'Post not found' })
    const accounts = await Account.findAll(wid, { kind: 'social' })
    return reply.send({ post: Post.serialize(post), accounts: accounts.map(Account.serialize) })
  })

  // POST /api/posts
  app.post('/posts', { preHandler: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const { account_ids = [], versions = [] } = request.body || {}
    if (!versions.length) return reply.code(422).send({ error: 'Post content is required' })

    try {
      await assertSocialPublishAccounts(wid, account_ids)
    } catch (err) {
      return reply.code(err.statusCode || 422).send({ error: err.message })
    }

    const json = await enqueueCreateDraftPost({
      workspace_id: wid,
      account_ids,
      versions,
    })
    if (!json.ok) {
      const sc = Number(json.status) || 502
      return reply.code(sc >= 400 && sc < 600 ? sc : 502).send({ error: json.error || 'Worker error' })
    }
    const postId = json.data?.id || json.data?.post_id
    if (!postId) return reply.code(502).send({ error: 'Worker did not return post id' })
    const post = await Post.findById(postId, wid)
    if (!post) return reply.code(502).send({ error: 'Post created but not found' })
    return reply.code(201).send(Post.serialize(post))
  })

  // PUT /api/posts/:id
  app.put('/posts/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const post = await Post.findByUuid(request.params.id, wid) || await Post.findById(request.params.id, wid)
    if (!post) return reply.code(404).send({ error: 'Post not found' })

    const { account_ids, versions, scheduled_at, status, schedule_status } = request.body || {}
    if (account_ids !== undefined) {
      try {
        await assertSocialPublishAccounts(wid, account_ids)
      } catch (err) {
        return reply.code(err.statusCode || 422).send({ error: err.message })
      }
    }
    const updated = await Post.updatePost(post._id.toString(), {
      ...(account_ids !== undefined && { account_ids }),
      ...(versions !== undefined && { versions }),
      ...(scheduled_at !== undefined && { scheduled_at: scheduled_at ? new Date(scheduled_at) : null }),
      ...(status !== undefined && { status }),
      ...(schedule_status !== undefined && { schedule_status }),
    })
    return reply.send(Post.serialize(updated))
  })

  // DELETE /api/posts/:id
  app.delete('/posts/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const post = await Post.findByUuid(request.params.id, wid) || await Post.findById(request.params.id, wid)
    if (!post) return reply.code(404).send({ error: 'Post not found' })
    await Post.deletePost(post._id.toString())
    return reply.code(204).send()
  })

  // DELETE /api/posts  (batch delete)
  app.delete('/posts', { preHandler: [authenticate] }, async (request, reply) => {
    const { ids = [] } = request.body || {}
    if (!ids.length) return reply.code(422).send({ error: 'No post IDs provided' })
    await Post.deleteManyPosts(ids)
    return reply.code(204).send()
  })

  // POST /api/posts/:id/schedule
  app.post('/posts/:id/schedule', { preHandler: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const post = await Post.findByUuid(request.params.id, wid) || await Post.findById(request.params.id, wid)
    if (!post) return reply.code(404).send({ error: 'Post not found' })

    const { scheduled_at, schedule_in_minutes, account_ids, platform } = request.body || {}
    const json = await enqueueSchedulePost({
      workspace_id: wid,
      post_id: post._id.toString(),
      scheduled_at,
      schedule_in_minutes,
      account_ids,
      platform,
    })
    if (!json.ok) {
      const sc = Number(json.status) || 502
      return reply.code(sc >= 400 && sc < 600 ? sc : 502).send({ error: json.error || 'Worker error' })
    }
    const updated = await Post.findById(json.data?.id || json.data?.post_id || post._id.toString(), wid)
    if (!updated) return reply.code(502).send({ error: 'Post scheduled but not found' })
    return reply.send(Post.serialize(updated))
  })

  // POST /api/posts/:id/reschedule — single entry point for calendar drag / any client moving scheduled_at
  // Draft: updates scheduled_at only. Scheduled: same validation + side effects as POST .../schedule.
  app.post('/posts/:id/reschedule', { preHandler: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const post = await Post.findByUuid(request.params.id, wid) || await Post.findById(request.params.id, wid)
    if (!post) return reply.code(404).send({ error: 'Post not found' })

    if (post.status === Post.PostStatus.PUBLISHED || post.status === Post.PostStatus.FAILED) {
      return reply.code(422).send({ error: 'This post cannot be rescheduled in its current state.' })
    }
    if (post.schedule_status === Post.ScheduleStatus.PROCESSING) {
      return reply.code(422).send({ error: 'This post is currently being published.' })
    }

    const { scheduled_at } = request.body || {}
    if (!scheduled_at) return reply.code(422).send({ error: 'scheduled_at is required' })

    const scheduledDate = new Date(scheduled_at)
    if (scheduledDate <= new Date()) {
      return reply.code(422).send({ error: 'The scheduled date cannot be in the past.' })
    }

    if (post.status === Post.PostStatus.SCHEDULED) {
      const json = await enqueueSchedulePost({
        workspace_id: wid,
        post_id: post._id.toString(),
        scheduled_at,
        account_ids: request.body?.account_ids,
        platform: request.body?.platform,
      })
      if (!json.ok) {
        const sc = Number(json.status) || 502
        return reply.code(sc >= 400 && sc < 600 ? sc : 502).send({ error: json.error || 'Worker error' })
      }
      const updated = await Post.findById(json.data?.id || json.data?.post_id || post._id.toString(), wid)
      return reply.send(Post.serialize(updated))
    }

    const updated = await Post.updatePost(post._id.toString(), { scheduled_at: scheduledDate })
    return reply.send(Post.serialize(updated))
  })

  // POST /api/posts/:id/publish — publish now (draft or scheduled); mirrors scheduler + PublishPost job
  app.post('/posts/:id/publish', { preHandler: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const post = await Post.findByUuid(request.params.id, wid) || await Post.findById(request.params.id, wid)
    if (!post) return reply.code(404).send({ error: 'Post not found' })

    const { account_ids, platform } = request.body || {}
    try {
      await preparePublishPostForWorkspace({
        workspace_id: wid,
        post_id: post._id.toString(),
        account_ids,
        platform,
      })
    } catch (err) {
      return reply.code(err.statusCode || 422).send({ error: err.message })
    }

    const out = await dispatchPublishPost(post._id.toString())
    return reply.code(202).send({
      ok: true,
      queued: true,
      via: out.via,
      bridge_task_id: out.task_id,
    })
  })

  // GET /api/posts/:id/comments
  app.get('/posts/:id/comments', { preHandler: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const post = await Post.findByUuid(request.params.id, wid) || await Post.findById(request.params.id, wid)
    if (!post) return reply.code(404).send({ error: 'Post not found' })
    try {
      assertPublishedPost(post)
    } catch (err) {
      return reply.code(err.statusCode || 422).send({ error: err.message })
    }
    const items = await listForPost(post._id.toString(), wid)
    return reply.send({ items, total: items.length })
  })

  // POST /api/posts/:id/comments/sync — queue comment sync for this post
  app.post('/posts/:id/comments/sync', { preHandler: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const post = await Post.findByUuid(request.params.id, wid) || await Post.findById(request.params.id, wid)
    if (!post) return reply.code(404).send({ error: 'Post not found' })
    try {
      assertPublishedPost(post)
    } catch (err) {
      return reply.code(err.statusCode || 422).send({ error: err.message })
    }
    await enqueueCeleryTask('tasks.social.sync_post_comments', [post._id.toString()])
    return reply.code(202).send({ ok: true, queued: true })
  })

  // POST /api/posts/:id/comments/:commentId/analyze
  app.post('/posts/:id/comments/:commentId/analyze', { preHandler: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const post = await Post.findByUuid(request.params.id, wid) || await Post.findById(request.params.id, wid)
    if (!post) return reply.code(404).send({ error: 'Post not found' })
    try {
      assertPublishedPost(post)
    } catch (err) {
      return reply.code(err.statusCode || 422).send({ error: err.message })
    }
    const record = await findByUuid(request.params.commentId, wid)
    if (!record || record.post_id !== post._id.toString()) {
      return reply.code(404).send({ error: 'Comment not found' })
    }
    try {
      const out = await runAnalysisForRecord(record, {
        userId: request.user?.id,
        execution_source: 'api_post_comment',
        post_context: record.post_context || postCaptionContext(post),
      })
      return reply.send(out)
    } catch (err) {
      return reply.code(err.statusCode || 422).send({ error: err.message })
    }
  })

  // POST /api/posts/:id/comments/:commentId/reply
  app.post('/posts/:id/comments/:commentId/reply', { preHandler: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const text = String(request.body?.text || '').trim()
    if (!text) return reply.code(422).send({ error: 'text is required' })
    const post = await Post.findByUuid(request.params.id, wid) || await Post.findById(request.params.id, wid)
    if (!post) return reply.code(404).send({ error: 'Post not found' })
    try {
      assertPublishedPost(post)
    } catch (err) {
      return reply.code(err.statusCode || 422).send({ error: err.message })
    }
    const record = await findByUuid(request.params.commentId, wid)
    if (!record || record.post_id !== post._id.toString()) {
      return reply.code(404).send({ error: 'Comment not found' })
    }
    if (!record.provider_comment_id || record.reply_supported === false) {
      return reply.code(422).send({ error: 'Replies are not supported for this comment' })
    }
    await markReplyPending(record.uuid, wid, text)
    await enqueueCeleryTask('tasks.social.reply_to_comment', [record.uuid])
    return reply.code(202).send({ ok: true, queued: true })
  })

  // GET /api/posts/:id/accounts  — per-account publish results
  app.get('/posts/:id/accounts', { preHandler: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const post = await Post.findByUuid(request.params.id, wid) || await Post.findById(request.params.id, wid)
    if (!post) return reply.code(404).send({ error: 'Post not found' })

    const results = await Post.findPublishAccountResults(post._id.toString())

    const accounts = await Account.findAll(wid)
    const accountMap = Object.fromEntries(accounts.map(a => [a._id.toString(), Account.serialize(a)]))

    return reply.send(results.map(r => ({
      account_id: r.account_id,
      account: accountMap[r.account_id] || null,
      provider_post_id: r.provider_post_id,
      success: r.errors?.length === 0,
      errors: r.errors || [],
      data: r.data || {},
    })))
  })

  // POST /api/posts/:id/duplicate
  app.post('/posts/:id/duplicate', { preHandler: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const post = await Post.findByUuid(request.params.id, wid) || await Post.findById(request.params.id, wid)
    if (!post) return reply.code(404).send({ error: 'Post not found' })

    const duplicate = await Post.duplicatePost(post._id.toString(), wid)
    return reply.code(201).send(Post.serialize(duplicate))
  })
}
