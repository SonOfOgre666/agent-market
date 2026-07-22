/**
 * Machine-to-machine routes for Celery (services/ai-worker).
 * Secured with WORKER_API_SECRET — keeps DB writes on the API per ARCHITECTURE_RULES.md.
 */
import { ObjectId } from 'mongodb'
import fs from 'fs/promises'
import path from 'path'
import { getDb } from '../lib/mongo.js'
import * as Post from '../models/Post.js'
import * as Media from '../models/Media.js'
import * as Campaign from '../models/Campaign.js'
import * as Account from '../models/Account.js'
import * as Integration from '../models/Integration.js'
import * as AiWorkspaceConfig from '../models/AiWorkspaceConfig.js'
import * as AiExecution from '../models/AiExecution.js'
import { getCatalog, catalogViews, resolveApiModelId } from '../models/AiCatalog.js'
import { getWorkspaceCatalogViews } from '../lib/aiCatalogWorkspace.js'
import * as Setting from '../models/Setting.js'
import { publishEvent } from '../lib/events.js'
import { createPostFromWorkerPayload, schedulePostForWorkspace, preparePublishPostForWorkspace } from '../services/postCreate.js'
import { runLandingPageWorkflow } from '../services/adsLandingPageWorkflow.js'
import { runHourlyPacingForAllWorkspaces, runWorkspacePacing, runWorkspaceBudgetReallocation } from '../services/adsBudgetPacing.js'
import {
  runHourlyBidOptimizationForAllWorkspaces,
  runBidOptimization,
  runQualityScoreMonitor,
  runAssetAbTestAnalysis,
  runCampaignOptimization,
} from '../services/adsOptimization.js'
import { runDailyNegativeKeywordReview } from '../services/adsNegativeKeywords.js'
import { buildWeeklyReportSnapshots } from '../services/budgetKpiReport.js'
import { enrichCampaignMetrics } from '../lib/campaignMetrics.js'
import { clusterSeoKeywords } from '../services/seoKeywordClusters.js'
import { checkWorkspaceKeywordRanks } from '../services/seoKeywordTracking.js'
import { auditWorkspaceLandingPages } from '../services/seoLandingAudit.js'
import { PostStatus } from '../models/Post.js'
import {
  upsertSynced,
  runAnalysisForRecord,
  findByUuid,
  applyReplyResult,
  postCaptionContext,
} from '../services/postComments.js'

const META_COMMENT_PROVIDERS = new Set(['facebook', 'facebook_page', 'instagram', 'instagram_login'])
const COMMENT_SYNC_PROVIDERS = new Set([
  ...META_COMMENT_PROVIDERS,
  'twitter',
  'linkedin',
])

function toPlain(v) {
  if (v === null || v === undefined) return v
  if (v instanceof ObjectId) return v.toString()
  if (v instanceof Date) return v.toISOString()
  if (Array.isArray(v)) return v.map(toPlain)
  if (typeof v === 'object') {
    const o = {}
    for (const [k, val] of Object.entries(v)) o[k] = toPlain(val)
    return o
  }
  return v
}

async function requireWorkerSecret(request, reply) {
  const secret = process.env.WORKER_API_SECRET
  if (!secret || String(secret).length < 8) {
    return reply.code(503).send({ error: 'WORKER_API_SECRET must be set (min 8 characters)' })
  }
  if ((request.headers['x-worker-secret'] || '') !== secret) {
    return reply.code(401).send({ error: 'Unauthorized' })
  }
}

async function appendAdsCampaignPublishError(campaignIdHex, message) {
  let oid
  try {
    oid = new ObjectId(campaignIdHex)
  } catch {
    return
  }
  const doc = await getDb().collection('ads_campaigns').findOne({ _id: oid })
  if (!doc) return
  const prev = [...(doc.publish_errors || [])]
  if (!prev.includes(message)) prev.push(message)
  while (prev.length > 5) prev.shift()
  await getDb().collection('ads_campaigns').updateOne(
    { _id: oid },
    { $set: { publish_errors: prev, updated_at: new Date() } },
  )
}

async function mergeGoogleAdsServiceForWorker(workspaceId) {
  const wid = workspaceId ? String(workspaceId) : null
  let cfg = await Integration.getDecryptedConfig('google_ads', wid)
  if (!cfg || !Object.keys(cfg).length) cfg = await Integration.getDecryptedConfig('google_ads')
  const merged = { ...(cfg && typeof cfg === 'object' ? cfg : {}) }
  if (!merged.client_id) merged.client_id = process.env.GOOGLE_ADS_CLIENT_ID
  if (!merged.client_secret) merged.client_secret = process.env.GOOGLE_ADS_CLIENT_SECRET
  if (!merged.developer_token) merged.developer_token = process.env.GOOGLE_ADS_DEVELOPER_TOKEN
  return merged
}

/** Persist pre-fetched campaign rows from ai-worker (no external HTTP). */
function coerceDate(v) {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

async function persistAdsWorkspaceSync(workspaceId, googleCampaigns, metaCampaigns) {
  const wid = String(workspaceId)
  const db = getDb()
  let google = 0
  let meta = 0
  for (const rc of googleCampaigns || []) {
    const metrics = enrichCampaignMetrics(rc.metrics)
    const filter = { workspace_id: wid, google_campaign_id: rc.google_campaign_id }
    const existing = await db.collection('ads_campaigns').findOne(filter)
    if (existing) {
      await db.collection('ads_campaigns').updateOne(filter, {
        $set: {
          name: rc.name,
          status: rc.status,
          budget: rc.budget,
          start_date: coerceDate(rc.start_date),
          end_date: coerceDate(rc.end_date),
          metrics,
          updated_at: new Date(),
        },
      })
    } else {
      const { nanoid } = await import('nanoid')
      await db.collection('ads_campaigns').insertOne({
        uuid: nanoid(),
        workspace_id: wid,
        google_campaign_id: rc.google_campaign_id,
        name: rc.name,
        platform: 'google_ads',
        type: rc.type,
        status: rc.status,
        budget: rc.budget,
        start_date: coerceDate(rc.start_date),
        end_date: coerceDate(rc.end_date),
        metrics,
        keywords: [],
        targeting: {},
        assets: {},
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      })
    }
    google += 1
  }
  for (const rc of metaCampaigns || []) {
    const metrics = enrichCampaignMetrics(rc.metrics)
    const filter = { workspace_id: wid, platform: { $in: ['meta', 'facebook', 'meta_ads'] }, platform_campaign_id: rc.meta_campaign_id }
    const existing = await db.collection('ads_campaigns').findOne(filter)
    if (existing) {
      await db.collection('ads_campaigns').updateOne(filter, {
        $set: {
          name: rc.name,
          status: rc.status,
          budget: rc.budget,
          objective: rc.objective,
          start_date: coerceDate(rc.start_date),
          end_date: coerceDate(rc.end_date),
          metrics,
          updated_at: new Date(),
        },
      })
    } else {
      const { nanoid } = await import('nanoid')
      await db.collection('ads_campaigns').insertOne({
        uuid: nanoid(),
        workspace_id: wid,
        platform_campaign_id: rc.meta_campaign_id,
        name: rc.name,
        platform: 'meta',
        status: rc.status,
        objective: rc.objective,
        budget: rc.budget,
        start_date: coerceDate(rc.start_date),
        end_date: coerceDate(rc.end_date),
        metrics,
        keywords: [],
        targeting: {},
        assets: {},
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      })
    }
    meta += 1
  }
  return { google, meta }
}

/** Upsert local ads_campaigns row after agent workflow publishes to Google/Meta. */
async function persistAgentPublishedCampaign(body) {
  const {
    workspace_id,
    account_id,
    platform,
    name,
    type,
    status,
    budget,
    start_date,
    end_date,
    keywords = [],
    targeting = {},
    creatives = {},
    platform_campaign_id,
    platform_ad_set_id,
    platform_ad_id,
  } = body || {}

  if (!workspace_id) throw new Error('workspace_id is required')
  if (!platform_campaign_id) throw new Error('platform_campaign_id is required')
  if (!platform) throw new Error('platform is required')

  const wid = String(workspace_id)
  const now = new Date()
  const platformRaw = String(platform).toLowerCase()
  const platformNorm = platformRaw === 'google' || platformRaw === 'google_ads'
    ? 'google_ads'
    : (platformRaw === 'meta' || platformRaw === 'facebook' || platformRaw === 'meta_ads' ? 'meta_ads' : platformRaw)

  const filter = {
    workspace_id: wid,
    platform_campaign_id: String(platform_campaign_id),
  }

  const $set = {
    name: String(name || 'Campaign'),
    platform: platformNorm,
    type: type || (platformNorm === 'google_ads' ? 'search' : 'social'),
    status: status || 'paused',
    budget: budget && typeof budget === 'object'
      ? budget
      : { amount: 0, currency: 'USD', type: 'daily' },
    start_date: coerceDate(start_date),
    end_date: coerceDate(end_date),
    keywords: Array.isArray(keywords) ? keywords : [],
    targeting: targeting && typeof targeting === 'object' ? targeting : {},
    creatives: creatives && typeof creatives === 'object' ? creatives : {},
    account_id: account_id != null ? String(account_id) : null,
    platform_campaign_id: String(platform_campaign_id),
    platform_ad_set_id: platform_ad_set_id != null ? String(platform_ad_set_id) : null,
    platform_ad_id: platform_ad_id != null ? String(platform_ad_id) : null,
    published_at: now,
    publish_errors: [],
    updated_at: now,
    deleted_at: null,
  }
  if (platformNorm === 'google_ads') {
    $set.google_campaign_id = String(platform_campaign_id)
  }

  const db = getDb()
  const existing = await db.collection('ads_campaigns').findOne(filter)
  if (existing) {
    await db.collection('ads_campaigns').updateOne(filter, { $set })
    return { ok: true, campaign_id: existing._id.toString(), created: false }
  }

  const { nanoid } = await import('nanoid')
  const doc = {
    uuid: nanoid(),
    workspace_id: wid,
    ...$set,
    metrics: {
      impressions: 0,
      clicks: 0,
      conversions: 0,
      spend: 0,
      conversion_value: 0,
      ctr: 0,
      cpc: 0,
      cpa: 0,
      roas: 0,
    },
    assets: {},
    ad_account_id: null,
    scheduled_at: null,
    schedule_status: null,
    created_at: now,
  }
  const result = await db.collection('ads_campaigns').insertOne(doc)
  return { ok: true, campaign_id: result.insertedId.toString(), created: true }
}

export default async function workerInternalRoutes(fastify) {
  fastify.addHook('preHandler', requireWorkerSecret)

  fastify.get('/internal/worker/post-publish-bundle/:postId', async (request, reply) => {
    let oid
    try {
      oid = new ObjectId(request.params.postId)
    } catch {
      return reply.code(400).send({ error: 'Invalid post id' })
    }
    const post = await getDb().collection(Post.COLLECTION).findOne({ _id: oid, deleted_at: null })
    if (!post) return reply.code(404).send({ error: 'Post not found' })

    const accountIds = (post.account_ids || []).map((x) => String(x))
    const accounts = []
    for (const aid of accountIds) {
      try {
        const acc = await getDb().collection('accounts').findOne({ _id: new ObjectId(aid) })
        if (acc) accounts.push(acc)
      } catch {
        /* skip invalid id */
      }
    }

    const wid = post.workspace_id ? String(post.workspace_id) : null
    let twitter_service = await Integration.getDecryptedConfig('twitter', wid || undefined)
    if (!Object.keys(twitter_service || {}).length) {
      twitter_service = await Integration.getDecryptedConfig('twitter')
    }
    let linkedin_service = await Integration.getDecryptedConfig('linkedin', wid || undefined)
    if (!Object.keys(linkedin_service || {}).length) {
      linkedin_service = await Integration.getDecryptedConfig('linkedin')
    }
    let facebook_service = await Integration.getDecryptedConfig('facebook', wid || undefined)
    if (!Object.keys(facebook_service || {}).length) {
      facebook_service = await Integration.getDecryptedConfig('facebook')
    }

    return reply.send({
      post: toPlain(post),
      accounts: accounts.map(toPlain),
      twitter_service,
      linkedin_service,
      facebook_service,
    })
  })

  fastify.patch('/internal/worker/posts/:postId', async (request, reply) => {
    const allowed = new Set(['status', 'schedule_status', 'published_at', 'updated_at'])
    const body = request.body || {}
    const fields = {}
    for (const [k, v] of Object.entries(body)) {
      if (!allowed.has(k)) continue
      if (k === 'published_at' || k === 'updated_at') {
        fields[k] = v === null ? null : new Date(v)
      } else {
        fields[k] = v
      }
    }
    if (!Object.keys(fields).length) {
      return reply.code(400).send({ error: 'No allowed fields (status, schedule_status, published_at, updated_at)' })
    }
    const updated = await Post.updatePost(request.params.postId, fields)
    if (!updated) return reply.code(404).send({ error: 'Post not found' })
    return reply.send({ ok: true, post: Post.serialize(updated) })
  })

  fastify.put('/internal/worker/post-accounts', async (request, reply) => {
    const { post_id, account_id, provider_post_id, data = {}, errors = [] } = request.body || {}
    if (!post_id || !account_id) {
      return reply.code(400).send({ error: 'post_id and account_id are required' })
    }
    await getDb().collection('post_accounts').updateOne(
      { post_id: String(post_id), account_id: String(account_id) },
      {
        $set: {
          post_id: String(post_id),
          account_id: String(account_id),
          provider_post_id: provider_post_id ?? null,
          data: data || {},
          errors: Array.isArray(errors) ? errors : [],
        },
      },
      { upsert: true },
    )
    return reply.send({ ok: true })
  })

  fastify.patch('/internal/worker/accounts/:accountId/deauthorize', async (request, reply) => {
    let oid
    try {
      oid = new ObjectId(request.params.accountId)
    } catch {
      return reply.code(400).send({ error: 'Invalid account id' })
    }
    const aid = String(request.params.accountId)
    await getDb().collection('accounts').updateOne(
      { _id: oid },
      { $set: { authorized: false, updated_at: new Date() } },
    )
    await publishEvent('account_unauthorized', { account_id: aid })
    return reply.send({ ok: true })
  })

  // GET /internal/worker/media/:mediaId/file — library bytes for worker (Meta upload, etc.)
  fastify.get('/internal/worker/media/:mediaId/file', async (request, reply) => {
    let oid
    try {
      oid = new ObjectId(request.params.mediaId)
    } catch {
      return reply.code(400).send({ error: 'Invalid media id' })
    }
    const workspaceId = request.query.workspace_id ? String(request.query.workspace_id) : null
    const media = await Media.findById(request.params.mediaId)
    if (!media) return reply.code(404).send({ error: 'Media not found' })
    if (workspaceId && String(media.workspace_id || '') !== workspaceId) {
      return reply.code(403).send({ error: 'Media does not belong to this workspace' })
    }
    const uploadDir = process.env.STORAGE_LOCAL_PATH || './uploads'
    const abs = path.join(uploadDir, media.path)
    let buf
    try {
      buf = await fs.readFile(abs)
    } catch {
      return reply.code(404).send({ error: 'Media file missing on disk' })
    }
    return reply.send({
      ok: true,
      id: media._id.toString(),
      mime_type: media.mime_type,
      name: media.name,
      file: `data:${media.mime_type};base64,${buf.toString('base64')}`,
      size: buf.length,
    })
  })

  // GET /internal/worker/accounts/:accountId/worker-context — full account doc for import/publish tasks (M2M only)
  fastify.get('/internal/worker/accounts/:accountId/worker-context', async (request, reply) => {
    let oid
    try {
      oid = new ObjectId(request.params.accountId)
    } catch {
      return reply.code(400).send({ error: 'Invalid account id' })
    }
    const acc = await getDb().collection('accounts').findOne({ _id: oid })
    if (!acc) return reply.code(404).send({ error: 'Account not found' })
    return reply.send(toPlain(acc))
  })

  // GET /internal/worker/accounts/list — workspace accounts for planner/tools (optional kind=social|ads)
  fastify.get('/internal/worker/accounts/list', async (request, reply) => {
    const { provider, workspace_id: workspaceId, kind } = request.query
    // Match Accounts UI (findAll): workspace scope only — not authorized-only (UI shows connected rows).
    const filter = { deleted_at: { $exists: false } }
    if (workspaceId) {
      const wid = String(workspaceId)
      let oid
      try {
        oid = new ObjectId(wid)
      } catch {
        oid = null
      }
      filter.$or = oid
        ? [{ workspace_id: wid }, { workspace_id: oid }]
        : [{ workspace_id: wid }]
    }
    if (provider) filter.provider = String(provider)
    const rows = await getDb().collection('accounts').find(filter).sort({ created_at: 1 }).limit(50).toArray()
    let items = rows.map((r) => {
      const customerId = r.data?.customer_id
        ? String(r.data.customer_id).replace(/\D/g, '') || null
        : null
      const isGoogleAds = r.provider === 'google_ads'
      return {
        id: r._id.toString(),
        provider: r.provider || '',
        name: r.name || '',
        username: r.username || '',
        authorized: r.authorized !== false,
        ad_account_id: r.data?.ad_account_id || null,
        customer_id: customerId,
        login_customer_id: r.data?.login_customer_id
          ? String(r.data.login_customer_id).replace(/\D/g, '') || null
          : null,
        currency: r.data?.currency || null,
        needs_reconnect: isGoogleAds ? !customerId : false,
      }
    })
    if (kind === 'social' || kind === 'ads') {
      items = Account.filterAccountsByKind(
        items.map((i) => ({ provider: i.provider, ...i })),
        kind,
      )
    }
    return reply.send({ items })
  })

  // GET /internal/worker/workspaces/:workspaceId/settings — planner + publish defaults
  fastify.get('/internal/worker/workspaces/:workspaceId/settings', async (request, reply) => {
    const workspaceId = String(request.params.workspaceId || '').trim()
    if (!workspaceId) return reply.code(400).send({ error: 'workspaceId required' })
    const settings = await Setting.getAll(workspaceId)
    return reply.send({
      default_accounts: Array.isArray(settings.default_accounts)
        ? settings.default_accounts.map(String)
        : [],
      agent_auto_approve: Boolean(settings.agent_auto_approve),
      timezone: settings.timezone || 'UTC',
    })
  })

  const integrationConfigDecrypted = async (request, reply) => {
    const wid = request.query.workspace_id ? String(request.query.workspace_id) : undefined
    const cfg = await Integration.getDecryptedConfig(request.params.name, wid)
    return reply.send(cfg && typeof cfg === 'object' ? cfg : {})
  }

  // GET /internal/worker/integration-config/:name?workspace_id=
  fastify.get('/internal/worker/integration-config/:name', integrationConfigDecrypted)

  fastify.get('/internal/worker/ai-catalog', async (_request, reply) => {
    const catalog = await getCatalog()
    return reply.send({ catalog, views: catalogViews(catalog) })
  })

  fastify.post('/internal/worker/ai-executions', async (request, reply) => {
    try {
      const row = await AiExecution.insertExecution(request.body || {})
      return reply.code(201).send({ ok: true, id: row._id.toString() })
    } catch (err) {
      const code = err.statusCode || 500
      return reply.code(code).send({ error: err.message })
    }
  })

  fastify.get('/internal/worker/ai-workspace-config', async (request, reply) => {
    const wid = request.query.workspace_id ? String(request.query.workspace_id) : null
    if (!wid) return reply.code(400).send({ error: 'workspace_id is required' })
    const catalog = await getCatalog()
    const views = await getWorkspaceCatalogViews(wid)
    const config = await AiWorkspaceConfig.getConfig(wid)
    const features = {}
    for (const [featureId, row] of Object.entries(config.features || {})) {
      features[featureId] = {
        ...row,
        api_model_id: resolveApiModelId(catalog, {
          featureId,
          providerId: row.provider,
          modelId: row.model,
        }),
      }
    }
    const planner = {
      ...config.planner,
      api_model_id: resolveApiModelId(catalog, {
        providerId: config.planner?.provider,
        modelId: config.planner?.model,
        planner: true,
      }),
    }
    return reply.send({
      features,
      planner,
      catalog_views: views,
    })
  })
  // Legacy alias (ai-worker versions before rename)
  fastify.get('/internal/worker/service-decrypted/:name', integrationConfigDecrypted)

  // PUT /internal/worker/audience — upsert one audience row (follower counts)
  fastify.put('/internal/worker/audience', async (request, reply) => {
    const { account_id, date, total } = request.body || {}
    if (!account_id || !date) return reply.code(400).send({ error: 'account_id and date are required' })
    const now = new Date()
    await getDb().collection('audience').updateOne(
      { account_id: String(account_id), date: String(date) },
      {
        $set: {
          account_id: String(account_id),
          date: String(date),
          total: Number(total) || 0,
          updated_at: now,
        },
        $setOnInsert: { created_at: now },
      },
      { upsert: true },
    )
    return reply.send({ ok: true })
  })

  // PUT /internal/worker/metrics/bulk-upsert
  fastify.put('/internal/worker/metrics/bulk-upsert', async (request, reply) => {
    const { items } = request.body || {}
    if (!Array.isArray(items) || !items.length) {
      return reply.code(400).send({ error: 'items array required' })
    }
    const now = new Date()
    let n = 0
    for (const it of items) {
      const { account_id, date, data, merge } = it || {}
      if (!account_id || !date || typeof data !== 'object') continue
      if (merge) {
        const setFields = {
          account_id: String(account_id),
          date: String(date),
          updated_at: now,
        }
        for (const [k, v] of Object.entries(data)) {
          setFields[`data.${k}`] = v
        }
        await getDb().collection('metrics').updateOne(
          { account_id: String(account_id), date: String(date) },
          { $set: setFields, $setOnInsert: { created_at: now } },
          { upsert: true },
        )
      } else {
        await getDb().collection('metrics').updateOne(
          { account_id: String(account_id), date: String(date) },
          {
            $set: {
              account_id: String(account_id),
              date: String(date),
              data,
              updated_at: now,
            },
            $setOnInsert: { created_at: now },
          },
          { upsert: true },
        )
      }
      n += 1
    }
    return reply.send({ ok: true, count: n })
  })

  // PUT /internal/worker/imported-posts/upsert
  fastify.put('/internal/worker/imported-posts/upsert', async (request, reply) => {
    const { account_id, provider_post_id, content, metrics } = request.body || {}
    if (!account_id || !provider_post_id) {
      return reply.code(400).send({ error: 'account_id and provider_post_id are required' })
    }
    const now = new Date()
    await getDb().collection('imported_posts').updateOne(
      { account_id: String(account_id), provider_post_id: String(provider_post_id) },
      {
        $set: {
          account_id: String(account_id),
          provider_post_id: String(provider_post_id),
          content: content && typeof content === 'object' ? content : {},
          metrics: metrics && typeof metrics === 'object' ? metrics : {},
          updated_at: now,
        },
        $setOnInsert: { created_at: now },
      },
      { upsert: true },
    )
    return reply.send({ ok: true })
  })

  // PUT /internal/worker/facebook-insights/upsert
  fastify.put('/internal/worker/facebook-insights/upsert', async (request, reply) => {
    const { account_id, type, value, date } = request.body || {}
    if (!account_id || type === undefined || type === null || !date) {
      return reply.code(400).send({ error: 'account_id, type, and date are required' })
    }
    const now = new Date()
    await getDb().collection('facebook_insights').updateOne(
      { account_id: String(account_id), type: Number(type), date: String(date) },
      {
        $set: {
          account_id: String(account_id),
          type: Number(type),
          value,
          date: String(date),
          updated_at: now,
        },
        $setOnInsert: { created_at: now },
      },
      { upsert: true },
    )
    return reply.send({ ok: true })
  })

  // GET /internal/worker/aggregates/imported-posts-twitter-metrics/:accountId
  fastify.get('/internal/worker/aggregates/imported-posts-twitter-metrics/:accountId', async (request, reply) => {
    const { accountId } = request.params
    const pipeline = [
      { $match: { account_id: accountId } },
      {
        $group: {
          _id: { $substr: ['$created_at', 0, 10] },
          likes: { $sum: '$metrics.likes' },
          replies: { $sum: '$metrics.replies' },
          retweets: { $sum: '$metrics.retweets' },
          impressions: { $sum: '$metrics.impressions' },
        },
      },
      { $sort: { _id: 1 } },
    ]
    const rows = await getDb().collection('imported_posts').aggregate(pipeline).toArray()
    return reply.send({
      items: rows.map((r) => ({
        date: r._id,
        likes: r.likes || 0,
        replies: r.replies || 0,
        retweets: r.retweets || 0,
        impressions: r.impressions || 0,
      })),
    })
  })

  // GET /internal/worker/aggregates/imported-posts-instagram-metrics/:accountId
  fastify.get('/internal/worker/aggregates/imported-posts-instagram-metrics/:accountId', async (request, reply) => {
    const { accountId } = request.params
    const pipeline = [
      { $match: { account_id: accountId } },
      {
        $group: {
          _id: { $substr: ['$content.created_at', 0, 10] },
          likes: { $sum: '$metrics.likes' },
          comments: { $sum: '$metrics.comments' },
          views: { $sum: '$metrics.views' },
        },
      },
      { $sort: { _id: 1 } },
    ]
    const rows = await getDb().collection('imported_posts').aggregate(pipeline).toArray()
    return reply.send({
      items: rows.map((r) => ({
        date: r._id,
        likes: r.likes || 0,
        comments: r.comments || 0,
        views: r.views || 0,
      })),
    })
  })

  // POST /internal/worker/maintenance/prune-old-imports — parity with scheduler_beat daily_delete_old_imports
  fastify.post('/internal/worker/maintenance/prune-old-imports', async (_request, reply) => {
    const cutoff = new Date()
    cutoff.setUTCDate(cutoff.getUTCDate() - 95)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    const ip = await getDb().collection('imported_posts').deleteMany({ created_at: { $lt: cutoff } })
    const fi = await getDb().collection('facebook_insights').deleteMany({ date: { $lt: cutoffStr } })
    return reply.send({ imported_posts: ip.deletedCount, facebook_insights: fi.deletedCount })
  })

  // GET /internal/worker/ads/sync-job-plan — workspaces that have Google and/or Meta ad accounts
  fastify.get('/internal/worker/ads/sync-job-plan', async (_request, reply) => {
    const accs = await getDb().collection('accounts').find({
      authorized: true,
      deleted_at: { $exists: false },
      provider: { $in: ['google_ads', 'meta_ads', 'facebook'] },
      workspace_id: { $exists: true, $ne: null },
    }).toArray()
    const map = new Map()
    for (const a of accs) {
      const wid = String(a.workspace_id)
      if (!map.has(wid)) map.set(wid, { workspace_id: wid, has_google: false, has_meta: false })
      const row = map.get(wid)
      if (a.provider === 'google_ads') row.has_google = true
      if (a.provider === 'meta_ads' || a.provider === 'facebook') row.has_meta = true
    }
    return reply.send({ workspaces: [...map.values()] })
  })

  fastify.get('/internal/worker/ads/sync-workspace-context/:workspaceId', async (request, reply) => {
    const wid = String(request.params.workspaceId || '')
    if (!wid) return reply.code(400).send({ error: 'workspace_id required' })
    const allAccounts = await Account.findAll(wid)
    const gadsAccount = allAccounts.find((a) => a.provider === 'google_ads' && a.authorized) || null
    const metaAccount = allAccounts.find((a) => (a.provider === 'meta_ads' || a.provider === 'facebook') && a.authorized) || null
    const google_service = await mergeGoogleAdsServiceForWorker(wid)
    const facebook_service = await Integration.getDecryptedConfig('facebook', wid) || {}
    return reply.send({
      workspace_id: wid,
      google_account: gadsAccount ? toPlain(gadsAccount) : null,
      meta_account: metaAccount ? toPlain(metaAccount) : null,
      google_service,
      facebook_service,
    })
  })

  fastify.post('/internal/worker/ads/sync-workspace-apply', async (request, reply) => {
    const { workspace_id, google_campaigns = [], meta_campaigns = [] } = request.body || {}
    if (!workspace_id) return reply.code(400).send({ error: 'workspace_id is required' })
    try {
      const stats = await persistAdsWorkspaceSync(
        String(workspace_id),
        google_campaigns,
        meta_campaigns,
      )
      return reply.send({ ok: true, workspace_id: String(workspace_id), ...stats })
    } catch (err) {
      fastify.log.error(err)
      return reply.code(500).send({ error: err.message })
    }
  })

  fastify.get('/internal/worker/ads/campaigns/:campaignId/publish-bundle', async (request, reply) => {
    let oid
    try {
      oid = new ObjectId(request.params.campaignId)
    } catch {
      return reply.code(400).send({ error: 'Invalid campaign id' })
    }
    const c = await getDb().collection('ads_campaigns').findOne({ _id: oid, deleted_at: null })
    if (!c) return reply.code(404).send({ error: 'Campaign not found' })
    const wid = c.workspace_id ? String(c.workspace_id) : null
    let acc = null
    if (c.account_id) {
      try {
        acc = await getDb().collection('accounts').findOne({ _id: new ObjectId(String(c.account_id)) })
      } catch {
        /* invalid account ref */
      }
    }
    const google_service = await mergeGoogleAdsServiceForWorker(wid)
    return reply.send({
      campaign: toPlain(c),
      account: toPlain(acc),
      google_service: google_service,
    })
  })

  fastify.post('/internal/worker/ads/campaigns/:campaignId/publish-errors', async (request, reply) => {
    const { message } = request.body || {}
    if (!message || typeof message !== 'string') return reply.code(400).send({ error: 'message is required' })
    await appendAdsCampaignPublishError(request.params.campaignId, message)
    return reply.send({ ok: true })
  })

  fastify.patch('/internal/worker/ads/campaigns/:campaignId/google-publish-result', async (request, reply) => {
    let oid
    try {
      oid = new ObjectId(request.params.campaignId)
    } catch {
      return reply.code(400).send({ error: 'Invalid campaign id' })
    }
    const { platform_campaign_id, platform_ad_set_id, platform_ad_id } = request.body || {}
    if (!platform_campaign_id) return reply.code(400).send({ error: 'platform_campaign_id is required' })
    const now = new Date()
    await getDb().collection('ads_campaigns').updateOne(
      { _id: oid },
      {
        $set: {
          platform_campaign_id: String(platform_campaign_id),
          platform_ad_set_id: platform_ad_set_id != null ? String(platform_ad_set_id) : null,
          platform_ad_id: platform_ad_id != null ? String(platform_ad_id) : null,
          status: 'active',
          published_at: now,
          publish_errors: [],
          updated_at: now,
        },
      },
    )
    return reply.send({ ok: true })
  })

  fastify.post('/internal/worker/ads/campaigns/agent-publish', async (request, reply) => {
    try {
      const result = await persistAgentPublishedCampaign(request.body || {})
      return reply.send(result)
    } catch (err) {
      fastify.log.error(err)
      return reply.code(400).send({ error: err.message })
    }
  })

  fastify.post('/internal/worker/events', async (request, reply) => {
    const body = request.body || {}
    const { event, ...payload } = body
    if (!event || typeof event !== 'string') {
      return reply.code(400).send({ error: 'event is required' })
    }
    await publishEvent(event, payload)
    return reply.send({ ok: true })
  })

  fastify.post('/internal/worker/scheduler/claim-due-posts', async (_request, reply) => {
    const rows = await Post.findScheduledReady()
    const ids = []
    const now = new Date()
    for (const post of rows) {
      await Post.updatePost(post._id.toString(), {
        schedule_status: Post.ScheduleStatus.PROCESSING,
        updated_at: now,
      })
      ids.push(post._id.toString())
    }
    return reply.send({ ids })
  })

  // POST /internal/worker/scheduler/claim-due-campaigns — same pattern as due posts (API owns ads_campaigns transitions)
  fastify.post('/internal/worker/scheduler/claim-due-campaigns', async (_request, reply) => {
    const rows = await Campaign.findScheduledReady()
    const ids = []
    for (const c of rows) {
      await Campaign.updateCampaign(c._id.toString(), { schedule_status: Campaign.ScheduleStatus.PROCESSING })
      ids.push(c._id.toString())
    }
    return reply.send({ ids })
  })

  // GET /internal/worker/scheduler/budget-alert-campaigns — Celery reads spend/budget via API only
  fastify.get('/internal/worker/scheduler/budget-alert-campaigns', async (_request, reply) => {
    const rows = await getDb().collection('ads_campaigns').find({
      deleted_at: null,
      status: { $in: ['active', 'paused'] },
      'budget.amount': { $gt: 0 },
    }).project({ name: 1, budget: 1, metrics: 1, workspace_id: 1 }).toArray()
    return reply.send({ campaigns: rows.map((c) => toPlain(c)) })
  })

  // GET /internal/worker/scheduler/weekly-report-snapshot — aggregates for weekly email (API reads Mongo)
  fastify.get('/internal/worker/scheduler/weekly-report-snapshot', async (_request, reply) => {
    const snapshot = await buildWeeklyReportSnapshots()
    return reply.send(snapshot)
  })

  // POST /internal/worker/mailer/weekly-report — weekly KPI email via API mailer (worker passes snapshot row only)
  fastify.post('/internal/worker/mailer/weekly-report', async (request, reply) => {
    const body = request.body || {}
    const emails = Array.isArray(body.emails)
      ? body.emails.filter((e) => typeof e === 'string' && e.includes('@'))
      : []
    const workspaceName = typeof body.workspaceName === 'string' ? body.workspaceName : ''
    const weekLabel = typeof body.weekLabel === 'string' ? body.weekLabel : ''
    const stats = body.stats && typeof body.stats === 'object' ? body.stats : null
    if (!emails.length || !workspaceName || !weekLabel || !stats) {
      return reply.code(400).send({
        error: 'emails (non-empty array of addresses), workspaceName, weekLabel, and stats object are required',
      })
    }
    const { sendWeeklyReport } = await import('../services/mailer.js')
    const result = await sendWeeklyReport({
      to: emails,
      workspaceName,
      weekLabel,
      stats,
    })
    return reply.send(result)
  })

  // --- Ads worker helpers ---

  fastify.get('/internal/worker/ads/campaigns/active-ids', async (_request, reply) => {
    const rows = await getDb().collection('ads_campaigns').find({
      status: 'active',
      deleted_at: null,
    }).project({ _id: 1 }).toArray()
    return reply.send({ ids: rows.map((r) => String(r._id)) })
  })

  fastify.get('/internal/worker/ads/campaigns/:campaignId/snapshot', async (request, reply) => {
    let oid
    try {
      oid = new ObjectId(request.params.campaignId)
    } catch {
      return reply.code(400).send({ error: 'Invalid campaign id' })
    }
    const c = await getDb().collection('ads_campaigns').findOne({ _id: oid, deleted_at: null })
    if (!c) return reply.code(404).send({ error: 'Not found' })
    return reply.send({
      campaign: toPlain({
        _id: c._id,
        name: c.name,
        workspace_id: c.workspace_id,
        keywords: c.keywords || [],
        metrics: c.metrics || {},
      }),
    })
  })

  fastify.patch('/internal/worker/ads/campaigns/:campaignId/campaign-assets', async (request, reply) => {
    let oid
    try {
      oid = new ObjectId(request.params.campaignId)
    } catch {
      return reply.code(400).send({ error: 'Invalid campaign id' })
    }
    const { assets } = request.body || {}
    if (!assets || typeof assets !== 'object') return reply.code(400).send({ error: 'assets object required' })
    const now = new Date()
    const res = await getDb().collection('ads_campaigns').updateOne(
      { _id: oid },
      { $set: { assets, updated_at: now } },
    )
    if (!res.matchedCount) return reply.code(404).send({ error: 'Not found' })
    return reply.send({ ok: true })
  })

  fastify.patch('/internal/worker/ads/campaigns/:campaignId/campaign-optimization', async (request, reply) => {
    let oid
    try {
      oid = new ObjectId(request.params.campaignId)
    } catch {
      return reply.code(400).send({ error: 'Invalid campaign id' })
    }
    const { optimization } = request.body || {}
    if (!optimization || typeof optimization !== 'object') return reply.code(400).send({ error: 'optimization object required' })
    const now = new Date()
    const res = await getDb().collection('ads_campaigns').updateOne(
      { _id: oid },
      { $set: { optimization, updated_at: now } },
    )
    if (!res.matchedCount) return reply.code(404).send({ error: 'Not found' })
    return reply.send({ ok: true })
  })

  fastify.post('/internal/worker/ads/campaigns/:campaignId/optimize', async (request, reply) => {
    try {
      const out = await runCampaignOptimization(request.params.campaignId, request.body || {})
      return reply.send(out)
    } catch (err) {
      const sc = err.statusCode && Number(err.statusCode) >= 400 && Number(err.statusCode) < 600 ? err.statusCode : 500
      return reply.code(sc).send({ error: err.message })
    }
  })

  // Worker task tasks.social.create_draft_post — DB persistence (UI + agent use same task)
  fastify.post('/internal/worker/posts/create', async (request, reply) => {
    try {
      const result = await createPostFromWorkerPayload(request.body || {})
      return reply.send(result)
    } catch (err) {
      return reply.code(err.statusCode || 500).send({ error: err.message })
    }
  })

  fastify.post('/internal/worker/posts/:postId/schedule', async (request, reply) => {
    try {
      const body = request.body || {}
      const result = await schedulePostForWorkspace({
        workspace_id: body.workspace_id,
        post_id: request.params.postId,
        scheduled_at: body.scheduled_at,
        schedule_in_minutes: body.schedule_in_minutes,
        account_ids: body.account_ids,
        platform: body.platform,
      })
      return reply.send(result)
    } catch (err) {
      return reply.code(err.statusCode || 500).send({ error: err.message })
    }
  })

  fastify.post('/internal/worker/posts/:postId/publish-prepare', async (request, reply) => {
    try {
      const body = request.body || {}
      const result = await preparePublishPostForWorkspace({
        workspace_id: body.workspace_id,
        post_id: request.params.postId,
        account_ids: body.account_ids,
        platform: body.platform,
      })
      return reply.send(result)
    } catch (err) {
      return reply.code(err.statusCode || 500).send({ error: err.message })
    }
  })

  fastify.get('/internal/worker/agent/workflows/:workflowId', async (request, reply) => {
    let oid
    try {
      oid = new ObjectId(request.params.workflowId)
    } catch {
      return reply.code(400).send({ error: 'Invalid workflow id' })
    }
    const wf = await getDb().collection('agent_workflows').findOne({ _id: oid })
    if (!wf) return reply.code(404).send({ error: 'Not found' })
    return reply.send({ workflow: toPlain(wf) })
  })

  fastify.patch('/internal/worker/agent/workflows/:workflowId', async (request, reply) => {
    let oid
    try {
      oid = new ObjectId(request.params.workflowId)
    } catch {
      return reply.code(400).send({ error: 'Invalid workflow id' })
    }
    const body = request.body || {}
    const $set = { updated_at: new Date() }
    const allowed = [
      'status', 'intent', 'summary', 'graph', 'approval_gates',
      'step_results', 'execution_errors',
    ]
    for (const k of allowed) {
      if (body[k] !== undefined) $set[k] = body[k]
    }
    const res = await getDb().collection('agent_workflows').updateOne({ _id: oid }, { $set })
    if (!res.matchedCount) return reply.code(404).send({ error: 'Not found' })
    const wf = await getDb().collection('agent_workflows').findOne({ _id: oid })
    return reply.send({ workflow: toPlain(wf) })
  })

  fastify.post('/internal/worker/seo/keywords/cluster', async (request, reply) => {
    const body = request.body || {}
    const workspaceId = body.workspace_id
    if (!workspaceId) return reply.code(422).send({ error: 'workspace_id is required' })
    try {
      const out = await clusterSeoKeywords(String(workspaceId), {
        seed_keywords: body.seed_keywords,
        business_context: body.business_context,
        locale: body.locale,
      })
      return reply.send(out)
    } catch (err) {
      const sc = err.statusCode && Number(err.statusCode) >= 400 && Number(err.statusCode) < 600 ? err.statusCode : 500
      return reply.code(sc).send({ error: err.message })
    }
  })

  fastify.post('/internal/worker/seo/keywords/check-ranks', async (request, reply) => {
    const body = request.body || {}
    const workspaceId = body.workspace_id
    if (!workspaceId) return reply.code(422).send({ error: 'workspace_id is required' })
    try {
      const out = await checkWorkspaceKeywordRanks(String(workspaceId), {
        target_ids: body.target_ids,
      })
      return reply.send(out)
    } catch (err) {
      const sc = err.statusCode && Number(err.statusCode) >= 400 && Number(err.statusCode) < 600 ? err.statusCode : 500
      return reply.code(sc).send({ error: err.message })
    }
  })

  fastify.get('/internal/worker/seo/landing-pages/audit', async (request, reply) => {
    const workspaceId = request.query?.workspace_id
    if (!workspaceId) return reply.code(422).send({ error: 'workspace_id query param is required' })
    try {
      const out = await auditWorkspaceLandingPages(String(workspaceId))
      return reply.send(out)
    } catch (err) {
      const sc = err.statusCode && Number(err.statusCode) >= 400 && Number(err.statusCode) < 600 ? err.statusCode : 500
      return reply.code(sc).send({ error: err.message })
    }
  })

  fastify.post('/internal/worker/ads/landing-pages/run-workflow', async (request, reply) => {
    const body = request.body || {}
    try {
      const out = await runLandingPageWorkflow({
        workspace_id: body.workspace_id,
        title: body.title,
        campaign_id: body.campaign_id,
        language: body.language,
        keywords: body.keywords,
        publish: Boolean(body.publish),
        async_content: Boolean(body.async),
      })
      return reply.send(out)
    } catch (err) {
      const sc = err.statusCode && Number(err.statusCode) >= 400 && Number(err.statusCode) < 600 ? err.statusCode : 500
      return reply.code(sc).send({ error: err.message })
    }
  })

  fastify.post('/internal/worker/ads/budget/pacing', async (request, reply) => {
    const body = request.body || {}
    const workspaceId = body.workspace_id
    if (!workspaceId) return reply.code(422).send({ error: 'workspace_id is required' })
    try {
      const out = await runWorkspacePacing(String(workspaceId), {
        targets: {
          target_cpa: body.target_cpa != null ? Number(body.target_cpa) : undefined,
          target_roas: body.target_roas != null ? Number(body.target_roas) : undefined,
        },
        persist: body.persist !== false,
        auto_pause_overspend: Boolean(body.auto_pause_overspend),
      })
      return reply.send(out)
    } catch (err) {
      const sc = err.statusCode && Number(err.statusCode) >= 400 && Number(err.statusCode) < 600 ? err.statusCode : 500
      return reply.code(sc).send({ error: err.message })
    }
  })

  fastify.post('/internal/worker/ads/budget/reallocation', async (request, reply) => {
    const body = request.body || {}
    const workspaceId = body.workspace_id
    if (!workspaceId) return reply.code(422).send({ error: 'workspace_id is required' })
    try {
      const out = await runWorkspaceBudgetReallocation(String(workspaceId), {
        target_cpa: body.target_cpa != null ? Number(body.target_cpa) : undefined,
        target_roas: body.target_roas != null ? Number(body.target_roas) : undefined,
      })
      return reply.send(out)
    } catch (err) {
      const sc = err.statusCode && Number(err.statusCode) >= 400 && Number(err.statusCode) < 600 ? err.statusCode : 500
      return reply.code(sc).send({ error: err.message })
    }
  })

  fastify.post('/internal/worker/ads/optimization/bid', async (request, reply) => {
    const body = request.body || {}
    const workspaceId = body.workspace_id
    if (!workspaceId) return reply.code(422).send({ error: 'workspace_id is required' })
    try {
      const out = await runBidOptimization(String(workspaceId), {
        target_cpa: body.target_cpa,
        target_roas: body.target_roas,
        account_id: body.account_id,
        campaign_id: body.campaign_id,
        date_range: body.date_range,
        include_keywords: body.include_keywords !== false,
        persist: body.persist !== false,
      })
      return reply.send(out)
    } catch (err) {
      const sc = err.statusCode && Number(err.statusCode) >= 400 && Number(err.statusCode) < 600 ? err.statusCode : 500
      return reply.code(sc).send({ error: err.message })
    }
  })

  fastify.get('/internal/worker/ads/optimization/quality-score', async (request, reply) => {
    const workspaceId = request.query?.workspace_id
    if (!workspaceId) return reply.code(422).send({ error: 'workspace_id query param is required' })
    try {
      const out = await runQualityScoreMonitor(String(workspaceId), {
        account_id: request.query.account_id,
        campaign_id: request.query.campaign_id || request.query.platform_campaign_id,
        date_range: request.query.date_range,
        persist: request.query.persist !== 'false',
      })
      return reply.send(out)
    } catch (err) {
      const sc = err.statusCode && Number(err.statusCode) >= 400 && Number(err.statusCode) < 600 ? err.statusCode : 500
      return reply.code(sc).send({ error: err.message })
    }
  })

  fastify.post('/internal/worker/ads/optimization/asset-ab', async (request, reply) => {
    const body = request.body || {}
    const workspaceId = body.workspace_id
    if (!workspaceId) return reply.code(422).send({ error: 'workspace_id is required' })
    try {
      const out = await runAssetAbTestAnalysis(String(workspaceId), {
        account_id: body.account_id,
        campaign_id: body.campaign_id || body.platform_campaign_id,
        date_range: body.date_range,
        min_impressions: body.min_impressions,
        persist: body.persist !== false,
      })
      return reply.send(out)
    } catch (err) {
      const sc = err.statusCode && Number(err.statusCode) >= 400 && Number(err.statusCode) < 600 ? err.statusCode : 500
      return reply.code(sc).send({ error: err.message })
    }
  })

  fastify.post('/internal/worker/ads/pacing/run-hourly', async (request, reply) => {
    const body = request.body || {}
    const out = await runHourlyPacingForAllWorkspaces({
      auto_pause_overspend: Boolean(body.auto_pause_overspend),
    })
    return reply.send(out)
  })

  fastify.post('/internal/worker/ads/bid-optimization/run-hourly', async (request, reply) => {
    const body = request.body || {}
    const out = await runHourlyBidOptimizationForAllWorkspaces({
      auto_apply: Boolean(body.auto_apply),
      target_cpa: body.target_cpa != null ? Number(body.target_cpa) : undefined,
      target_roas: body.target_roas != null ? Number(body.target_roas) : undefined,
    })
    return reply.send(out)
  })

  fastify.post('/internal/worker/ads/negative-keywords/run-daily', async (_request, reply) => {
    const out = await runDailyNegativeKeywordReview()
    return reply.send(out)
  })

  fastify.patch('/internal/worker/ads/landing-pages/:landingPageId/landing-page-content', async (request, reply) => {
    let oid
    try {
      oid = new ObjectId(request.params.landingPageId)
    } catch {
      return reply.code(400).send({ error: 'Invalid landing page id' })
    }
    const { headline, subheadline, body, cta_text: ctaText } = request.body || {}
    const now = new Date()
    const $set = { updated_at: now }
    if (headline != null) $set.headline = String(headline)
    if (subheadline != null) $set.subheadline = String(subheadline)
    if (body != null) $set.body = String(body)
    if (ctaText != null) $set.cta_text = String(ctaText)
    const res = await getDb().collection('ads_landing_pages').updateOne({ _id: oid }, { $set })
    if (!res.matchedCount) return reply.code(404).send({ error: 'Not found' })
    return reply.send({ ok: true })
  })

  fastify.get('/internal/worker/comment-sync/post-ids', async (_request, reply) => {
    const db = getDb()
    const paRows = await db.collection('post_accounts').find({
      provider_post_id: { $exists: true, $nin: [null, ''] },
    }).project({ post_id: 1 }).toArray()
    const uniqueIds = [...new Set(paRows.map((r) => r.post_id).filter(Boolean))]
    const published = []
    for (const pid of uniqueIds) {
      try {
        const post = await db.collection(Post.COLLECTION).findOne(
          { _id: new ObjectId(pid), deleted_at: null, status: PostStatus.PUBLISHED },
          { projection: { _id: 1 } },
        )
        if (post) published.push(String(pid))
      } catch {
        /* skip invalid id */
      }
    }
    return reply.send({ ids: published })
  })

  fastify.get('/internal/worker/posts/:postId/comment-sync-bundle', async (request, reply) => {
    let oid
    try {
      oid = new ObjectId(request.params.postId)
    } catch {
      return reply.code(400).send({ error: 'Invalid post id' })
    }
    const post = await getDb().collection(Post.COLLECTION).findOne({ _id: oid, deleted_at: null })
    if (!post) return reply.code(404).send({ error: 'Post not found' })

    const paRows = await getDb().collection('post_accounts').find({
      post_id: String(post._id),
      provider_post_id: { $exists: true, $nin: [null, ''] },
    }).toArray()

    const targets = []
    for (const row of paRows) {
      try {
        const acc = await getDb().collection('accounts').findOne({ _id: new ObjectId(row.account_id) })
        if (!acc || !COMMENT_SYNC_PROVIDERS.has(String(acc.provider || ''))) continue
        targets.push({
          account_id: String(acc._id),
          provider: acc.provider,
          provider_post_id: String(row.provider_post_id),
          account: toPlain(acc),
        })
      } catch {
        /* skip invalid account */
      }
    }

    const wid = post.workspace_id ? String(post.workspace_id) : null
    let twitter_service = await Integration.getDecryptedConfig('twitter', wid || undefined)
    if (!Object.keys(twitter_service || {}).length) {
      twitter_service = await Integration.getDecryptedConfig('twitter')
    }
    let linkedin_service = await Integration.getDecryptedConfig('linkedin', wid || undefined)
    if (!Object.keys(linkedin_service || {}).length) {
      linkedin_service = await Integration.getDecryptedConfig('linkedin')
    }
    let facebook_service = await Integration.getDecryptedConfig('facebook', wid || undefined)
    if (!Object.keys(facebook_service || {}).length) {
      facebook_service = await Integration.getDecryptedConfig('facebook')
    }

    return reply.send({
      post: toPlain(post),
      post_context: postCaptionContext(post),
      targets,
      twitter_service,
      linkedin_service,
      facebook_service,
    })
  })

  fastify.post('/internal/worker/post-comments/upsert', async (request, reply) => {
    const body = request.body || {}
    const workspace_id = body.workspace_id ? String(body.workspace_id) : null
    if (!workspace_id) return reply.code(422).send({ error: 'workspace_id is required' })
    try {
      const out = await upsertSynced({
        workspace_id,
        post_id: body.post_id,
        account_id: body.account_id,
        provider: body.provider,
        provider_post_id: body.provider_post_id,
        provider_comment_id: body.provider_comment_id,
        comment: body.comment,
        author: body.author,
        platform_created_at: body.platform_created_at,
        post_context: body.post_context,
        reply_supported: body.reply_supported,
      })
      return reply.send({ ok: true, isNew: out.isNew, uuid: out.record?.uuid })
    } catch (err) {
      return reply.code(err.statusCode || 422).send({ error: err.message })
    }
  })

  fastify.get('/internal/worker/post-comments/:uuid/worker-context', async (request, reply) => {
    const record = await findByUuid(request.params.uuid)
    if (!record) return reply.code(404).send({ error: 'Comment not found' })
    let account = null
    if (record.account_id) {
      try {
        account = await getDb().collection('accounts').findOne({ _id: new ObjectId(record.account_id) })
      } catch {
        account = null
      }
    }
    const wid = record.workspace_id ? String(record.workspace_id) : null
    const provider = String(record.provider || account?.provider || '')
    let twitter_service = await Integration.getDecryptedConfig('twitter', wid || undefined)
    if (!Object.keys(twitter_service || {}).length) {
      twitter_service = await Integration.getDecryptedConfig('twitter')
    }
    let linkedin_service = await Integration.getDecryptedConfig('linkedin', wid || undefined)
    if (!Object.keys(linkedin_service || {}).length) {
      linkedin_service = await Integration.getDecryptedConfig('linkedin')
    }
    let facebook_service = await Integration.getDecryptedConfig('facebook', wid || undefined)
    if (!Object.keys(facebook_service || {}).length) {
      facebook_service = await Integration.getDecryptedConfig('facebook')
    }
    return reply.send({
      comment: toPlain(record),
      account: account ? toPlain(account) : null,
      provider,
      twitter_service,
      linkedin_service,
      facebook_service,
    })
  })

  fastify.post('/internal/worker/post-comments/:uuid/analyze', async (request, reply) => {
    const record = await findByUuid(request.params.uuid)
    if (!record) return reply.code(404).send({ error: 'Comment not found' })
    try {
      const out = await runAnalysisForRecord(record, {
        execution_source: 'worker_auto_analyze',
      })
      return reply.send(out)
    } catch (err) {
      return reply.code(err.statusCode || 422).send({ error: err.message })
    }
  })

  fastify.patch('/internal/worker/post-comments/:uuid/reply-result', async (request, reply) => {
    const record = await findByUuid(request.params.uuid)
    if (!record) return reply.code(404).send({ error: 'Comment not found' })
    const body = request.body || {}
    await applyReplyResult(record.uuid, record.workspace_id, {
      ok: Boolean(body.ok),
      provider_reply_id: body.provider_reply_id,
      error: body.error,
    })
    return reply.send({ ok: true })
  })
}
