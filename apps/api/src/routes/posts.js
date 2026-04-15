import { authenticate } from '../middleware/auth.js'
import * as Post from '../models/Post.js'
import * as Tag from '../models/Tag.js'
import * as Account from '../models/Account.js'
import { getRedis } from '../db/redis.js'

export default async function postRoutes(app) {
  // GET /api/posts
  app.get('/posts', { preHandler: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const { status, tag_id, keyword, account_id, page = 1, per_page = 15 } = request.query
    const result = await Post.findAll({ workspace_id: wid, status, tag_id, keyword, account_id, page: parseInt(page), per_page: parseInt(per_page) })
    const tags = await Tag.findAll(wid)
    return reply.send({ ...result, items: result.items.map(Post.serialize), tags: tags.map(Tag.serialize) })
  })

  // GET /api/posts/:id
  app.get('/posts/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const post = await Post.findByUuid(request.params.id, wid) || await Post.findById(request.params.id, wid)
    if (!post) return reply.code(404).send({ error: 'Post not found' })
    const accounts = await Account.findAll(wid)
    const tags = await Tag.findAll(wid)
    return reply.send({ post: Post.serialize(post), accounts: accounts.map(Account.serialize), tags: tags.map(Tag.serialize) })
  })

  // POST /api/posts
  app.post('/posts', { preHandler: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const { account_ids = [], tag_ids = [], versions = [], scheduled_at } = request.body || {}
    if (!versions.length) return reply.code(422).send({ error: 'Post content is required' })

    const post = await Post.createPost({ workspace_id: wid, account_ids, tag_ids, versions, scheduled_at })
    return reply.code(201).send(Post.serialize(post))
  })

  // PUT /api/posts/:id
  app.put('/posts/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const post = await Post.findByUuid(request.params.id, wid) || await Post.findById(request.params.id, wid)
    if (!post) return reply.code(404).send({ error: 'Post not found' })

    const { account_ids, tag_ids, versions, scheduled_at, status } = request.body || {}
    const updated = await Post.updatePost(post._id.toString(), {
      ...(account_ids !== undefined && { account_ids }),
      ...(tag_ids !== undefined && { tag_ids }),
      ...(versions !== undefined && { versions }),
      ...(scheduled_at !== undefined && { scheduled_at: scheduled_at ? new Date(scheduled_at) : null }),
      ...(status !== undefined && { status }),
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

    if (post.status === Post.PostStatus.PUBLISHED || post.status === Post.PostStatus.FAILED) {
      return reply.code(422).send({ error: 'This post has already been published and cannot be rescheduled.' })
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

    if (!post.account_ids?.length) {
      return reply.code(422).send({ error: 'The post must have at least one account selected.' })
    }

    const updated = await Post.updatePost(post._id.toString(), {
      status: Post.PostStatus.SCHEDULED,
      schedule_status: Post.ScheduleStatus.PENDING,
      scheduled_at: scheduledDate,
    })

    getRedis().publish('agentmarket:post_scheduled', JSON.stringify({ post_id: post._id.toString() }))
    return reply.send(Post.serialize(updated))
  })

  // GET /api/posts/:id/accounts  — per-account publish results
  app.get('/posts/:id/accounts', { preHandler: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const post = await Post.findByUuid(request.params.id, wid) || await Post.findById(request.params.id, wid)
    if (!post) return reply.code(404).send({ error: 'Post not found' })

    const { getDb } = await import('../db/mongodb.js')
    const results = await getDb().collection('post_accounts')
      .find({ post_id: post._id.toString() })
      .toArray()

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
