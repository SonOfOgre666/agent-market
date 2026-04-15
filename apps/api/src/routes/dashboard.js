import { authenticate } from '../middleware/auth.js'
import * as Account from '../models/Account.js'
import { getDb } from '../db/mongodb.js'
import { PostStatus } from '../models/Post.js'

export default async function dashboardRoutes(app) {
  // GET /api/dashboard
  app.get('/dashboard', { preHandler: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const accounts = await Account.findAll(wid)
    const db = getDb()

    const userFilter = { deleted_at: null, workspace_id: wid }
    const [totalPosts, scheduledPosts, publishedPosts, failedPosts] = await Promise.all([
      db.collection('posts').countDocuments(userFilter),
      db.collection('posts').countDocuments({ ...userFilter, status: PostStatus.SCHEDULED }),
      db.collection('posts').countDocuments({ ...userFilter, status: PostStatus.PUBLISHED }),
      db.collection('posts').countDocuments({ ...userFilter, status: PostStatus.FAILED }),
    ])

    return reply.send({
      accounts: accounts.map(Account.serialize),
      stats: { total_posts: totalPosts, scheduled: scheduledPosts, published: publishedPosts, failed: failedPosts },
    })
  })
}
