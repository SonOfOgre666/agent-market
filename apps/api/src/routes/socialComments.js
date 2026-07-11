import { authenticate } from '../middleware/auth.js'
import {
  analyzeAndPersistComment,
  listCommentAnalyses,
} from '../services/socialCommentAnalyze.js'
import { enqueueCeleryTask } from '../lib/celeryEnqueue.js'
import { PostStatus, COLLECTION as POST_COLLECTION } from '../models/Post.js'
import { getDb } from '../lib/mongo.js'
import { ObjectId } from 'mongodb'

export default async function socialCommentsRoutes(app) {
  // Canonical workspace route (UI + agent parity)
  app.post('/posts/comments/analyze', { preHandler: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const userId = request.user?.id
    const { comment, platform = 'instagram', post_context: postContext } = request.body || {}

    try {
      const out = await analyzeAndPersistComment({
        comment,
        platform,
        post_context: postContext,
        workspace_id: wid,
        userId,
        execution_source: 'api_posts',
      })
      return reply.send(out)
    } catch (err) {
      return reply.code(err.statusCode || 422).send({ error: err.message })
    }
  })

  app.get('/posts/comments', { preHandler: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const { limit = 30, synced_only } = request.query
    const items = await listCommentAnalyses({
      workspace_id: wid,
      limit: parseInt(limit, 10) || 30,
      synced_only: synced_only === '1' || synced_only === 'true',
    })
    return reply.send({ items, total: items.length })
  })

  // POST /api/posts/comments/sync — queue sync for all published posts in workspace
  app.post('/posts/comments/sync', { preHandler: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const db = getDb()
    const paRows = await db.collection('post_accounts').find({
      provider_post_id: { $exists: true, $nin: [null, ''] },
    }).project({ post_id: 1 }).toArray()
    const postIds = [...new Set(paRows.map((r) => r.post_id).filter(Boolean))]
    const queued = []
    for (const pid of postIds) {
      try {
        const post = await db.collection(POST_COLLECTION).findOne({
          _id: new ObjectId(pid),
          deleted_at: null,
          workspace_id: wid,
          status: PostStatus.PUBLISHED,
        }, { projection: { _id: 1 } })
        if (post) {
          await enqueueCeleryTask('tasks.social.sync_post_comments', [String(pid)])
          queued.push(String(pid))
        }
      } catch {
        /* skip */
      }
    }
    return reply.code(202).send({ ok: true, queued: queued.length })
  })
}
