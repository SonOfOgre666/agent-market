/**
 * Dashboard KPIs — single implementation for GET /api/dashboard (workspace JWT).
 */
import { getDb } from '../lib/mongo.js'
import { PostStatus } from '../models/Post.js'

async function countAdsSummary(workspaceId) {
  const db = getDb()
  const ws = String(workspaceId)
  const [campaigns, activeCampaigns, landingPages, leads] = await Promise.all([
    db.collection('ads_campaigns').countDocuments({ workspace_id: ws, deleted_at: null }),
    db.collection('ads_campaigns').countDocuments({ workspace_id: ws, deleted_at: null, status: 'active' }),
    db.collection('ads_landing_pages').countDocuments({ workspace_id: ws, deleted_at: null }),
    db.collection('ads_leads').countDocuments({ workspace_id: ws }),
  ])
  return {
    campaigns: { total: campaigns, active: activeCampaigns },
    landing_pages: { total: landingPages },
    leads: { total: leads },
  }
}

async function countWorkspacePosts(workspaceId) {
  const db = getDb()
  const filter = { deleted_at: null, workspace_id: String(workspaceId) }
  const [total, scheduled, published, failed, draft] = await Promise.all([
    db.collection('posts').countDocuments(filter),
    db.collection('posts').countDocuments({ ...filter, status: PostStatus.SCHEDULED }),
    db.collection('posts').countDocuments({ ...filter, status: PostStatus.PUBLISHED }),
    db.collection('posts').countDocuments({ ...filter, status: PostStatus.FAILED }),
    db.collection('posts').countDocuments({ ...filter, status: PostStatus.DRAFT }),
  ])
  return { total, scheduled, published, failed, draft }
}

/** Weekly report + Beat — published in period + currently scheduled. */
export async function countWorkspacePostActivity(workspaceId, { since } = {}) {
  const db = getDb()
  const filter = { deleted_at: null, workspace_id: String(workspaceId) }
  const publishedFilter = {
    ...filter,
    status: PostStatus.PUBLISHED,
    ...(since ? { published_at: { $gte: since } } : {}),
  }
  const [posts_published, posts_scheduled] = await Promise.all([
    db.collection('posts').countDocuments(publishedFilter),
    db.collection('posts').countDocuments({ ...filter, status: PostStatus.SCHEDULED }),
  ])
  return { posts_published, posts_scheduled }
}

function postExcerpt(post) {
  const v = post?.versions?.[0]
  const body = v?.content?.body || v?.content?.caption || ''
  return String(body).substring(0, 100)
}

async function recentWorkspacePosts(workspaceId, limit = 5) {
  const rows = await getDb().collection('posts').find({
    deleted_at: null,
    workspace_id: String(workspaceId),
  }).sort({ created_at: -1 }).limit(limit).toArray()

  return rows.map((p) => ({
    id: p._id.toString(),
    status: p.status,
    text: postExcerpt(p),
    scheduled_at: p.scheduled_at,
    created_at: p.created_at,
  }))
}

/** Canonical dashboard (JWT workspace). */
export async function getWorkspaceDashboard(workspaceId) {
  const [posts, ads, recent_posts] = await Promise.all([
    countWorkspacePosts(workspaceId),
    countAdsSummary(workspaceId),
    recentWorkspacePosts(workspaceId, 5),
  ])

  return {
    workspace_id: String(workspaceId),
    stats: {
      total_posts: posts.total,
      scheduled: posts.scheduled,
      published: posts.published,
      failed: posts.failed,
      posts,
      ...ads,
    },
    recent_posts,
  }
}
