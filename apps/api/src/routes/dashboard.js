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

  // GET /api/dashboard/overview?userId=wetaxi
  app.get('/dashboard/overview', async (request, reply) => {
    const { userId } = request.query
    if (!userId) return reply.code(422).send({ error: 'userId query param is required' })

    const db = getDb()

    const [socialPosts, campaigns, landingPages, leads] = await Promise.all([
      db.collection('social_posts').countDocuments({ userId }),
      db.collection('ads_campaigns').countDocuments({ userId, deleted_at: null }).catch(() => 0),
      db.collection('ads_landing_pages').countDocuments({ userId, deleted_at: null }).catch(() => 0),
      db.collection('ads_leads').countDocuments({ userId }).catch(() => 0),
    ])

    const [scheduled, published, draft] = await Promise.all([
      db.collection('social_posts').countDocuments({ userId, status: 'scheduled' }),
      db.collection('social_posts').countDocuments({ userId, status: 'published' }),
      db.collection('social_posts').countDocuments({ userId, status: 'draft' }),
    ])

    // Recent events feed
    const recentPosts = await db.collection('social_posts')
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray()

    return reply.send({
      userId,
      stats: {
        social_posts: { total: socialPosts, scheduled, published, draft },
        campaigns: { total: campaigns },
        landing_pages: { total: landingPages },
        leads: { total: leads },
      },
      recent_posts: recentPosts.map(p => ({
        id: p.uuid,
        channel: p.channel,
        text: p.text?.substring(0, 100),
        status: p.status,
        scheduledAt: p.scheduledAt,
        createdAt: p.createdAt,
      })),
    })
  })
}
