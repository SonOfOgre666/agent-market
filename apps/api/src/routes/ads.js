import { authenticate } from '../middleware/auth.js'
import * as Campaign from '../models/Campaign.js'
import * as LandingPage from '../models/LandingPage.js'
import * as Lead from '../models/Lead.js'
import * as Account from '../models/Account.js'
import { getDb } from '../lib/mongo.js'
import { getRedis } from '../lib/redis.js'
import { enqueueCeleryTask } from '../lib/celeryEnqueue.js'
import { enqueueCeleryAndWaitForJson } from '../lib/p2ExecCeleryReply.js'
import { dispatchPublishCampaign } from '../queue/dispatcher.js'
import { ADS_CAMPAIGN_PLATFORMS } from '../constants/accountKinds.js'
import { getAdsWorkflowSchema, listAdsWorkflowPlatforms } from '../lib/adsWorkflowSchemas.js'
import { enrichAdsToolPayload } from '../lib/adsToolPayload.js'
import { enqueueOptimizeCampaign } from '../lib/adsQueues.js'
import { runLandingPageWorkflow } from '../services/adsLandingPageWorkflow.js'
import { runWorkspacePacing, runWorkspaceBudgetReallocation, applyBudgetReallocation } from '../services/adsBudgetPacing.js'
import {
  runBidOptimization,
  applyBidRecommendations,
  runQualityScoreMonitor,
  runAssetAbTestAnalysis,
  applyAssetAbRecommendations,
} from '../services/adsOptimization.js'
import {
  runCompetitiveAnalysis,
  listRecentCompetitiveAnalyses,
} from '../services/competitiveAnalysis.js'
import { aggregateBudgetTotals } from '../lib/campaignPlatforms.js'
import { buildWorkspaceKpiStats, renderKpiReportPdf } from '../services/budgetKpiReport.js'
import {
  summarizeLeadAttribution,
  ATTRIBUTION_COOKIE,
  parseAttributionCookie,
  resolveLeadTouchpoints,
  normalizeLeadTouch,
  mergeLeadTouchpoints,
} from '../services/leadAttribution.js'
import * as Workspace from '../models/Workspace.js'
import {
  suggestAndPersistForCampaign,
  suggestNegativeKeywords,
  persistNegativeKeywordSuggestions,
} from '../services/adsNegativeKeywords.js'

async function pickGoogleAdsAccountId(workspaceId, explicitAccountId) {
  if (explicitAccountId) return String(explicitAccountId)
  const accounts = await Account.findAll(workspaceId, { kind: 'ads' })
  const google = accounts.filter(
    (a) => a.provider === 'google_ads' && a.authorized !== false,
  )
  if (google.length === 1) {
    return String(google[0]._id)
  }
  return null
}

export default async function adsRoutes(app) {

  // GET /api/ads/workflows — platforms with schema-driven campaign flows
  app.get('/ads/workflows', { preHandler: [authenticate] }, async (_request, reply) => {
    return reply.send({ platforms: listAdsWorkflowPlatforms() })
  })

  // GET /api/ads/workflows/:platform/schema — UI stepper + validation contract
  app.get('/ads/workflows/:platform/schema', { preHandler: [authenticate] }, async (request, reply) => {
    const schema = getAdsWorkflowSchema(request.params.platform)
    if (!schema) return reply.code(404).send({ error: 'Unknown ads platform workflow' })
    return reply.send(schema)
  })

  const GOOGLE_DOCS_ONLY_TOOLS = new Set([
    'google_docs_gaql',
    'google_docs_reporting_views',
    'google_docs_reporting_fields',
  ])

  // POST /api/ads/tools/execute — run reusable ads tool via worker (UI / agents)
  // meta_create_ad_pixel / meta_update_ad_pixel: agent_flow admin_setup (direct execute only)
  app.post('/ads/tools/execute', { preHandler: [authenticate] }, async (request, reply) => {
    const { tool_id, payload } = request.body || {}
    if (!tool_id) return reply.code(422).send({ error: 'tool_id is required' })
    try {
      let enriched
      const rawPayload = payload && typeof payload === 'object' ? payload : {}
      try {
        if (GOOGLE_DOCS_ONLY_TOOLS.has(String(tool_id))) {
          enriched = rawPayload
        } else {
          enriched = await enrichAdsToolPayload(
            request.workspace_id,
            String(tool_id),
            rawPayload,
          )
        }
      } catch (err) {
        const sc = err.statusCode && Number(err.statusCode) >= 400 ? err.statusCode : 422
        return reply.code(sc).send({ error: err.message })
      }
      const json = await enqueueCeleryAndWaitForJson(
        'tasks.ads.execute_ads_tool',
        [String(tool_id), enriched],
        { timeoutMs: 120000 },
      )
      if (!json.ok) {
        return reply.code(422).send({
          error: json.error || 'Tool execution failed',
          details: json.data && typeof json.data === 'object' ? json.data : null,
        })
      }
      return reply.send(json)
    } catch (err) {
      const sc = err.statusCode && Number(err.statusCode) >= 400 && Number(err.statusCode) < 600 ? err.statusCode : 500
      return reply.code(sc).send({ error: err.message })
    }
  })

  // ─── CAMPAIGNS ──────────────────────────────────────────────────────────────

  // GET /api/ads/campaigns?userId=wetaxi  (or JWT auth)
  app.get('/ads/campaigns', { preHandler: [authenticate] }, async (request, reply) => {
    const { userId, status, platform, page, per_page } = request.query
    const workspaceId = userId || request.workspace_id
    if (!workspaceId) {
      return reply.code(403).send({ error: 'No workspace in session — log in again or pass userId' })
    }
    const statusFilter =
      status && String(status).trim() && String(status) !== 'undefined' ? String(status).trim() : undefined
    const result = await Campaign.findAll(workspaceId, {
      status: statusFilter,
      platform,
      page: parseInt(page || 1, 10),
      per_page: parseInt(per_page || 20, 10),
    })
    return reply.send({ ...result, items: result.items.map(Campaign.serialize) })
  })

  // GET /api/ads/campaigns/:id
  app.get('/ads/campaigns/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const c = await Campaign.findByUuid(request.params.id, request.workspace_id) || await Campaign.findById(request.params.id, request.workspace_id)
    if (!c) return reply.code(404).send({ error: 'Campaign not found' })
    return reply.send(Campaign.serialize(c))
  })

  // POST /api/ads/campaigns
  // Accepts README format: { userId, name, goal, budgetDaily }
  // Also accepts full format: { name, platform, type, budget, ... } with JWT auth
  app.post('/ads/campaigns', { preHandler: [authenticate] }, async (request, reply) => {
    const body = request.body || {}
    const {
      userId,
      name,
      goal,
      budgetDaily,
      platform,
      type,
      budget,
      start_date,
      end_date,
      keywords,
      targeting,
      objective,
      creatives,
      account_id,
      ad_account_id,
      pixel_id,
      custom_event_type,
      application_id,
      object_store_url,
      lead_gen_form_id,
    } = body

    if (!name) return reply.code(422).send({ error: 'name is required' })

    const workspaceId = userId || request.workspace_id
    if (!workspaceId) {
      return reply.code(403).send({ error: 'No workspace in session — log in again' })
    }

    // Map README fields (goal, budgetDaily) to internal fields
    const resolvedPlatform = platform || (goal ? 'google_ads' : null)
    if (!resolvedPlatform) return reply.code(422).send({ error: 'platform or goal is required' })
    if (!ADS_CAMPAIGN_PLATFORMS.includes(resolvedPlatform)) {
      return reply.code(422).send({ error: 'platform must be google_ads or meta_ads' })
    }

    const resolvedBudget = budget || (budgetDaily ? { amount: budgetDaily, type: 'daily' } : undefined)

    const c = await Campaign.createCampaign({
      workspace_id: workspaceId,
      name,
      platform: resolvedPlatform,
      goal: goal || null,
      objective: objective || goal || null,
      type,
      budget: resolvedBudget,
      start_date,
      end_date,
      keywords,
      targeting,
      creatives: creatives || {},
      account_id: account_id || null,
      ad_account_id: ad_account_id || null,
      pixel_id: pixel_id || null,
      custom_event_type: custom_event_type || null,
      application_id: application_id || null,
      object_store_url: object_store_url || null,
      lead_gen_form_id: lead_gen_form_id || creatives?.lead_gen_form_id || null,
    })
    return reply.code(201).send(Campaign.serialize(c))
  })

  // PATCH /api/ads/campaigns/:id
  app.patch('/ads/campaigns/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const c = await Campaign.findByUuid(request.params.id, request.workspace_id) || await Campaign.findById(request.params.id, request.workspace_id)
    if (!c) return reply.code(404).send({ error: 'Campaign not found' })
    const body = request.body || {}
    const updated = await Campaign.updateCampaign(c._id.toString(), body)

    // If status changed and this campaign is already live on Google Ads, sync remote status via worker
    if (body.status && body.status !== c.status && c.platform_campaign_id && c.account_id) {
      try {
        const account = await Account.findById(c.account_id)
        if (account?.authorized && String(account.provider || '') === 'google_ads') {
          try {
            const json = await enqueueCeleryAndWaitForJson(
              'tasks.ads.update_remote_campaign_status',
              [
                String(request.workspace_id),
                String(account._id),
                String(c.platform_campaign_id),
                String(body.status),
              ],
              { timeoutMs: 60000 },
            )
            if (!json.ok) {
              app.log.warn(
                `[Campaign] Worker could not sync status "${body.status}" to Google Ads: ${json.error || json.status}`,
              )
            }
          } catch (syncErr) {
            app.log.warn(
              `[Campaign] Could not sync status "${body.status}" to platform: ${syncErr.message}`,
            )
          }
        }
      } catch (syncErr) {
        app.log.warn(`[Campaign] Could not sync status "${body.status}" to platform: ${syncErr.message}`)
      }
    }

    return reply.send(Campaign.serialize(updated))
  })

  // DELETE /api/ads/campaigns/:id
  app.delete('/ads/campaigns/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const c = await Campaign.findByUuid(request.params.id, request.workspace_id) || await Campaign.findById(request.params.id, request.workspace_id)
    if (!c) return reply.code(404).send({ error: 'Campaign not found' })
    await Campaign.deleteCampaign(c._id.toString())
    return reply.code(204).send()
  })

  // POST /api/ads/campaigns/:id/publish — publish immediately to connected ad account
  app.post('/ads/campaigns/:id/publish', { preHandler: [authenticate] }, async (request, reply) => {
    const c = await Campaign.findByUuid(request.params.id, request.workspace_id) || await Campaign.findById(request.params.id, request.workspace_id)
    if (!c) return reply.code(404).send({ error: 'Campaign not found' })
    if (!c.account_id) return reply.code(422).send({ error: 'No account configured. Select a connected Facebook page or Google Ads account.' })

    // Allow the caller to pass final updates (creatives, ad_account_id, etc.) in the same request
    const bodyUpdates = request.body || {}
    if (Object.keys(bodyUpdates).length) {
      await Campaign.updateCampaign(c._id.toString(), bodyUpdates)
    }

    const out = await dispatchPublishCampaign(c._id.toString())
    return reply.code(202).send({
      ok: true,
      queued: true,
      via: out.via,
      bridge_task_id: out.task_id,
    })
  })

  // POST /api/ads/campaigns/:id/schedule — schedule campaign for a future date
  app.post('/ads/campaigns/:id/schedule', { preHandler: [authenticate] }, async (request, reply) => {
    const c = await Campaign.findByUuid(request.params.id, request.workspace_id) || await Campaign.findById(request.params.id, request.workspace_id)
    if (!c) return reply.code(404).send({ error: 'Campaign not found' })

    const { scheduled_at } = request.body || {}
    if (!scheduled_at) return reply.code(422).send({ error: 'scheduled_at is required (ISO datetime)' })
    if (!c.account_id) return reply.code(422).send({ error: 'No ad account configured. Set an ad account on the campaign first.' })

    const date = new Date(scheduled_at)
    if (isNaN(date.getTime())) return reply.code(422).send({ error: 'Invalid scheduled_at date' })
    if (date <= new Date()) return reply.code(422).send({ error: 'scheduled_at must be in the future' })

    const updated = await Campaign.updateCampaign(c._id.toString(), {
      scheduled_at: date,
      schedule_status: Campaign.ScheduleStatus.PENDING,
    })
    return reply.send(Campaign.serialize(updated))
  })

  // DELETE /api/ads/campaigns/:id/schedule — cancel a scheduled campaign
  app.delete('/ads/campaigns/:id/schedule', { preHandler: [authenticate] }, async (request, reply) => {
    const c = await Campaign.findByUuid(request.params.id, request.workspace_id) || await Campaign.findById(request.params.id, request.workspace_id)
    if (!c) return reply.code(404).send({ error: 'Campaign not found' })
    if (c.schedule_status !== Campaign.ScheduleStatus.PENDING) {
      return reply.code(422).send({ error: 'Campaign is not in a pending scheduled state' })
    }
    const updated = await Campaign.updateCampaign(c._id.toString(), {
      scheduled_at: null,
      schedule_status: null,
    })
    return reply.send(Campaign.serialize(updated))
  })

  // GET /api/ads/ad-accounts — Google Ads + Meta Ads connections only (not social pages)
  app.get('/ads/ad-accounts', { preHandler: [authenticate] }, async (request, reply) => {
    const adsAccounts = await Account.findAll(request.workspace_id, { kind: 'ads' })
    const result = []

    for (const a of adsAccounts) {
      if (!a.authorized) continue

      if (a.provider === 'meta_ads') {
        result.push({
          account_id: a._id.toString(),
          account_name: a.name,
          provider: 'meta_ads',
          ad_account_id: a.data?.ad_account_id || null,
          ad_account_name: a.data?.ad_account_name || a.name,
          currency: a.data?.currency || null,
          status_label: 'Active',
          needs_reconnect: false,
        })
      } else if (a.provider === 'google_ads') {
        const customerId = a.data?.customer_id
        result.push({
          account_id: a._id.toString(),
          account_name: a.name,
          provider: 'google_ads',
          ad_account_id: customerId || null,
          ad_account_name: customerId
            ? (a.data?.account_type_label
              ? `${a.data.account_type_label} (${customerId})`
              : `Customer ${customerId}`)
            : a.name,
          currency: a.data?.currency || 'USD',
          status_label: customerId
            ? (a.data?.account_type_label || 'Linked')
            : 'Select customer',
          needs_reconnect: !customerId,
          login_customer_id: a.data?.login_customer_id || null,
          account_type_label: a.data?.account_type_label || null,
        })
      }
    }

    return reply.send({ items: result })
  })

  // GET /api/ads/meta/ad-accounts — still runs meta_get_ad_accounts on the worker; web UI uses POST /ads/tools/execute via metaAdsTools.listMetaAdAccounts for parity with the agent.
  app.get('/ads/meta/ad-accounts', { preHandler: [authenticate] }, async (request, reply) => {
    const { account_id } = request.query
    if (!account_id) return reply.code(422).send({ error: 'account_id is required' })

    const account = await Account.findByUuid(account_id) || await Account.findById(account_id)
    if (!account) return reply.code(404).send({ error: 'Account not found' })
    if (account.workspace_id && account.workspace_id !== request.workspace_id) {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    const prov = account.provider
    if (!['meta_ads', 'facebook', 'meta'].includes(prov)) {
      return reply.code(422).send({ error: 'Account must be a Meta Ads connection' })
    }

    const token = account.data?.user_token || account.access_token?.token
    if (!token) return reply.code(400).send({ error: 'No user token on this account. Reconnect Meta Ads.' })

    const storedAct = account.data?.ad_account_id
    const storedRow = storedAct
      ? [{
          id: String(storedAct).startsWith('act_') ? String(storedAct) : `act_${String(storedAct).replace(/^act_/, '')}`,
          name: account.data?.ad_account_name || account.name || String(storedAct),
          currency: account.data?.currency || null,
          status_label: 'Connected',
        }]
      : []

    const mapRows = (rows) =>
      (rows || []).map((a) => ({
        id: a.id,
        name: a.name || a.id,
        currency: a.currency || null,
        status_label: a.status_label || null,
      }))

    const mergeUnique = (primary, extra) => {
      const out = [...(primary || [])]
      for (const row of extra || []) {
        if (row?.id && !out.some((x) => x.id === row.id)) out.push(row)
      }
      return out
    }

    try {
      const enriched = await enrichAdsToolPayload(
        request.workspace_id,
        'meta_get_ad_accounts',
        {
          account_id: String(account._id),
          user_id: request.query.user_id || 'me',
          limit: request.query.limit ? parseInt(request.query.limit, 10) : 200,
        },
      )
      const json = await enqueueCeleryAndWaitForJson(
        'tasks.ads.execute_ads_tool',
        ['meta_get_ad_accounts', enriched],
        { timeoutMs: 120000 },
      )
      if (!json.ok) {
        if (storedRow.length) return reply.send(storedRow)
        const sc = Number(json.status) || 502
        return reply
          .code(Number.isFinite(sc) && sc >= 400 && sc < 600 ? sc : 502)
          .send({ error: json.error || 'Worker error' })
      }
      const toolOut = json.data || {}
      const rows = toolOut.accounts || []
      return reply.send(mergeUnique(mapRows(rows), storedRow))
    } catch (err) {
      if (storedRow.length) return reply.send(storedRow)
      const sc =
        err.statusCode && Number(err.statusCode) >= 400 && Number(err.statusCode) < 600
          ? err.statusCode
          : 500
      return reply.code(sc).send({ error: err.message })
    }
  })

  // GET /api/ads/facebook-pages?account_id=X&ad_account_id=act_Y — registry meta_get_account_pages
  app.get('/ads/facebook-pages', { preHandler: [authenticate] }, async (request, reply) => {
    const { account_id, ad_account_id: queryAct } = request.query
    if (!account_id) return reply.code(422).send({ error: 'account_id is required' })

    const account = await Account.findByUuid(account_id) || await Account.findById(account_id)
    if (!account) return reply.code(404).send({ error: 'Account not found' })
    if (account.workspace_id && account.workspace_id !== request.workspace_id) return reply.code(403).send({ error: 'Forbidden' })

    const token = account.data?.user_token || account.access_token?.token
    if (!token) return reply.code(400).send({ error: 'No user token on this account. Reconnect it.' })

    const mapPageRows = (rows) =>
      (rows || []).map((p) => ({
        id: p.id,
        name: p.name || p.id,
        avatar: p.picture?.data?.url || (typeof p.picture === 'string' ? p.picture : null),
        username: p.username || null,
        category: p.category || null,
      }))

    const actId =
      queryAct ||
      account.data?.ad_account_id ||
      null
    if (!actId) {
      return reply.code(422).send({ error: 'ad_account_id is required (select a Meta ad account first)' })
    }
    try {
      const enriched = await enrichAdsToolPayload(request.workspace_id, 'meta_get_account_pages', {
        account_id: String(account._id),
        ad_account_id: String(actId),
      })
      const json = await enqueueCeleryAndWaitForJson(
        'tasks.ads.execute_ads_tool',
        ['meta_get_account_pages', enriched],
        { timeoutMs: 120000 },
      )
      if (!json.ok) {
        const sc = Number(json.status) || 502
        return reply
          .code(Number.isFinite(sc) && sc >= 400 && sc < 600 ? sc : 502)
          .send({ error: json.error || 'Worker error' })
      }
      const toolOut = json.data || {}
      const pages = toolOut.data || []
      return reply.send(mapPageRows(pages))
    } catch (err) {
      const sc = err.statusCode && Number(err.statusCode) >= 400 && Number(err.statusCode) < 600 ? err.statusCode : 500
      return reply.code(sc).send({ error: err.message })
    }
  })

  // GET /api/ads/meta/pixels?account_id=X&ad_account_id=act_Y — registry meta_list_ad_pixels
  app.get('/ads/meta/pixels', { preHandler: [authenticate] }, async (request, reply) => {
    const { account_id, ad_account_id: queryAct } = request.query
    if (!account_id) return reply.code(422).send({ error: 'account_id is required' })

    const account = await Account.findByUuid(account_id) || await Account.findById(account_id)
    if (!account) return reply.code(404).send({ error: 'Account not found' })
    if (account.workspace_id && account.workspace_id !== request.workspace_id) return reply.code(403).send({ error: 'Forbidden' })

    const actId = queryAct || account.data?.ad_account_id || null
    if (!actId) {
      return reply.code(422).send({ error: 'ad_account_id is required (select a Meta ad account first)' })
    }

    try {
      const enriched = await enrichAdsToolPayload(request.workspace_id, 'meta_list_ad_pixels', {
        account_id: String(account._id),
        ad_account_id: String(actId),
      })
      const json = await enqueueCeleryAndWaitForJson(
        'tasks.ads.execute_ads_tool',
        ['meta_list_ad_pixels', enriched],
        { timeoutMs: 120000 },
      )
      if (!json.ok) {
        const sc = Number(json.status) || 502
        return reply
          .code(Number.isFinite(sc) && sc >= 400 && sc < 600 ? sc : 502)
          .send({ error: json.error || 'Worker error' })
      }
      const toolOut = json.data || {}
      const pixels = (toolOut.pixels || toolOut.data || []).map((p) => ({
        id: p.id || p.pixel_id,
        pixel_id: p.pixel_id || p.id,
        name: p.name || p.id,
        is_unavailable: Boolean(p.is_unavailable),
        last_fired_time: p.last_fired_time || null,
      }))
      return reply.send({
        pixels,
        default_pixel_id: toolOut.default_pixel_id || null,
      })
    } catch (err) {
      const sc = err.statusCode && Number(err.statusCode) >= 400 && Number(err.statusCode) < 600 ? err.statusCode : 500
      return reply.code(sc).send({ error: err.message })
    }
  })

  // ─── LANDING PAGES ──────────────────────────────────────────────────────────

  // GET /api/ads/landing-pages?userId=wetaxi  (or JWT auth)
  app.get('/ads/landing-pages', async (request, reply) => {
    const { userId, status, page, per_page } = request.query
    let workspaceId = userId
    if (!userId) {
      try {
        await request.jwtVerify()
        workspaceId = request.user?.workspace_id
        if (!workspaceId) return reply.code(403).send({ error: 'No workspace selected' })
      } catch { return reply.code(401).send({ error: 'userId query param or auth token required' }) }
    }
    const result = await LandingPage.findAll(workspaceId, { status, page: parseInt(page || 1), per_page: parseInt(per_page || 20) })
    return reply.send({ ...result, items: result.items.map(LandingPage.serialize) })
  })

  // GET /api/ads/landing-pages/:slug  — public: slug lookup (no auth)
  // Also accessible with ?userId= for context
  app.get('/ads/landing-pages/:slug', async (request, reply) => {
    const p = await LandingPage.findBySlug(request.params.slug)
    if (!p) return reply.code(404).send({ error: 'Landing page not found' })
    await LandingPage.incrementViewCount(p._id.toString())
    const updated = await LandingPage.findBySlug(request.params.slug)
    return reply.send(LandingPage.serialize(updated || p))
  })

  // POST /api/ads/landing-pages
  app.post('/ads/landing-pages', { preHandler: [authenticate] }, async (request, reply) => {
    const { title, campaign_id, headline, subheadline, body, cta_text, cta_url, form_fields, meta } = request.body || {}
    if (!title) return reply.code(422).send({ error: 'title is required' })
    const p = await LandingPage.createLandingPage({ workspace_id: request.workspace_id, campaign_id, title, headline, subheadline, body, cta_text, cta_url, form_fields, meta })
    return reply.code(201).send(LandingPage.serialize(p))
  })

  // PATCH /api/ads/landing-pages/:slug
  app.patch('/ads/landing-pages/:slug', { preHandler: [authenticate] }, async (request, reply) => {
    const p = await LandingPage.findBySlug(request.params.slug) || await LandingPage.findById(request.params.slug, request.workspace_id)
    if (!p) return reply.code(404).send({ error: 'Landing page not found' })
    const updated = await LandingPage.updateLandingPage(p._id.toString(), request.body || {})
    return reply.send(LandingPage.serialize(updated))
  })

  // DELETE /api/ads/landing-pages/:slug
  app.delete('/ads/landing-pages/:slug', { preHandler: [authenticate] }, async (request, reply) => {
    const p = await LandingPage.findBySlug(request.params.slug) || await LandingPage.findById(request.params.slug, request.workspace_id)
    if (!p) return reply.code(404).send({ error: 'Landing page not found' })
    await LandingPage.deleteLandingPage(p._id.toString())
    return reply.code(204).send()
  })

  // POST /api/ads/landing-pages/:slug/touch — public: server-side attribution journey (httpOnly cookie)
  app.post('/ads/landing-pages/:slug/touch', async (request, reply) => {
    const page = await LandingPage.findBySlug(request.params.slug)
    if (!page) return reply.code(404).send({ error: 'Landing page not found' })

    const { utm = {} } = request.body || {}
    const cookieJourney = parseAttributionCookie(request.cookies?.[ATTRIBUTION_COOKIE])
    const touch = normalizeLeadTouch(utm, { landing_page: page.slug })
    const next = mergeLeadTouchpoints(cookieJourney, [touch])

    reply.setCookie(ATTRIBUTION_COOKIE, JSON.stringify(next), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 90 * 86400,
    })
    return reply.send({ ok: true, touch_count: next.length })
  })

  // POST /api/ads/landing-pages/:slug/lead  — public: capture a lead (no auth)
  app.post('/ads/landing-pages/:slug/lead', async (request, reply) => {
    const page = await LandingPage.findBySlug(request.params.slug)
    if (!page) return reply.code(404).send({ error: 'Landing page not found' })

    const { data = {}, utm = {}, touchpoints } = request.body || {}
    const cookieTouchpoints = parseAttributionCookie(request.cookies?.[ATTRIBUTION_COOKIE])
    const mergedTouchpoints = resolveLeadTouchpoints({
      clientTouchpoints: touchpoints,
      cookieTouchpoints,
      utm,
      landingPageSlug: page.slug,
    })

    const requiredFields = (page.form_fields || []).filter(f => f.required).map(f => f.name)
    for (const field of requiredFields) {
      if (!data[field]) return reply.code(422).send({ error: `${field} is required` })
    }

    const ip = request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.ip
    const lead = await Lead.createLead({
      workspace_id: page.workspace_id,
      landing_page_id: page._id.toString(),
      landing_page_slug: page.slug,
      campaign_id: page.campaign_id,
      data,
      utm,
      touchpoints: mergedTouchpoints,
      ip,
      user_agent: request.headers['user-agent'],
    })
    await LandingPage.incrementLeadCount(page._id.toString())
    reply.clearCookie(ATTRIBUTION_COOKIE, { path: '/' })
    return reply.code(201).send({ success: true, lead_id: lead.uuid })
  })

  // ─── LEADS ──────────────────────────────────────────────────────────────────

  // GET /api/ads/leads?userId=wetaxi  (or JWT auth)
  app.get('/ads/leads', async (request, reply) => {
    const { userId, landing_page_id, campaign_id, page, per_page } = request.query
    let workspaceId = userId
    if (!userId) {
      try {
        await request.jwtVerify()
        workspaceId = request.user?.workspace_id
        if (!workspaceId) return reply.code(403).send({ error: 'No workspace selected' })
      } catch { return reply.code(401).send({ error: 'userId query param or auth token required' }) }
    }
    const result = await Lead.findAll(workspaceId, { landing_page_id, campaign_id, page: parseInt(page || 1), per_page: parseInt(per_page || 30) })
    return reply.send({ ...result, items: result.items.map(Lead.serialize) })
  })

  // ─── BUDGET / KPI ────────────────────────────────────────────────────────────

  // GET /api/ads/budget-summary
  app.get('/ads/budget-summary', { preHandler: [authenticate] }, async (request, reply) => {
    const campaigns = await Campaign.findAll(request.workspace_id, { per_page: 1000 })
    return reply.send(aggregateBudgetTotals(campaigns.items))
  })

  // GET /api/ads/reports/kpi-pdf — §9.6 downloadable KPI report
  app.get('/ads/reports/kpi-pdf', { preHandler: [authenticate] }, async (request, reply) => {
    const days = Math.min(365, Math.max(1, Number(request.query?.days) || 7))
    const stats = await buildWorkspaceKpiStats(request.workspace_id, { days })
    const ws = await Workspace.findById(request.workspace_id)
    const workspaceName = ws?.name || 'Workspace'
    const periodLabel = `Last ${days} days`
    const pdf = renderKpiReportPdf({ workspaceName, periodLabel, stats })
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="kpi-report-${days}d.pdf"`)
      .send(pdf)
  })

  // POST /api/ads/budget/pacing — KPI pacing analysis (ARCHITECTURE: budget pacing)
  app.post('/ads/budget/pacing', { preHandler: [authenticate] }, async (request, reply) => {
    const body = request.body || {}
    const targets = {
      target_cpa: body.target_cpa != null ? Number(body.target_cpa) : undefined,
      target_roas: body.target_roas != null ? Number(body.target_roas) : undefined,
    }
    const result = await runWorkspacePacing(request.workspace_id, {
      targets,
      persist: body.persist !== false,
      auto_pause_overspend: Boolean(body.auto_pause_overspend),
    })
    return reply.send(result)
  })

  // POST /api/ads/budget/reallocation — §9.4 dynamic budget allocation (recommendations only)
  app.post('/ads/budget/reallocation', { preHandler: [authenticate] }, async (request, reply) => {
    const body = request.body || {}
    const out = await runWorkspaceBudgetReallocation(request.workspace_id, {
      target_cpa: body.target_cpa != null ? Number(body.target_cpa) : undefined,
      target_roas: body.target_roas != null ? Number(body.target_roas) : undefined,
    })
    return reply.send(out)
  })

  // POST /api/ads/budget/reallocation/apply — apply shifts to local campaign budgets
  app.post('/ads/budget/reallocation/apply', { preHandler: [authenticate] }, async (request, reply) => {
    const body = request.body || {}
    const shifts = body.shifts
    if (!Array.isArray(shifts) || !shifts.length) {
      return reply.code(422).send({ error: 'shifts array is required' })
    }
    const out = await applyBudgetReallocation(request.workspace_id, shifts, {
      dry_run: Boolean(body.dry_run),
    })
    return reply.send(out)
  })

  // POST /api/ads/optimization/bid — CPA/ROAS bid recommendations (campaign + keyword level)
  app.post('/ads/optimization/bid', { preHandler: [authenticate] }, async (request, reply) => {
    const body = request.body || {}
    try {
      const out = await runBidOptimization(request.workspace_id, {
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

  // POST /api/ads/optimization/bid/apply — apply keyword bid adjustments via worker tools
  app.post('/ads/optimization/bid/apply', { preHandler: [authenticate] }, async (request, reply) => {
    const body = request.body || {}
    const recs = body.keyword_recommendations
    if (!Array.isArray(recs) || !recs.length) {
      return reply.code(422).send({ error: 'keyword_recommendations array is required' })
    }
    try {
      const out = await applyBidRecommendations(request.workspace_id, {
        keyword_recommendations: recs,
        dry_run: Boolean(body.dry_run),
        max_applies: body.max_applies,
      })
      return reply.send(out)
    } catch (err) {
      const sc = err.statusCode && Number(err.statusCode) >= 400 && Number(err.statusCode) < 600 ? err.statusCode : 500
      return reply.code(sc).send({ error: err.message })
    }
  })

  // GET /api/ads/optimization/quality-score — quality score monitoring + recommendations
  app.get('/ads/optimization/quality-score', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const out = await runQualityScoreMonitor(request.workspace_id, {
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

  // POST /api/ads/optimization/asset-ab — compare ad variants within ad groups
  app.post('/ads/optimization/asset-ab', { preHandler: [authenticate] }, async (request, reply) => {
    const body = request.body || {}
    try {
      const out = await runAssetAbTestAnalysis(request.workspace_id, {
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

  // POST /api/ads/optimization/asset-ab/apply — pause losing ad variants
  app.post('/ads/optimization/asset-ab/apply', { preHandler: [authenticate] }, async (request, reply) => {
    const body = request.body || {}
    const experiments = body.experiments
    if (!Array.isArray(experiments) || !experiments.length) {
      return reply.code(422).send({ error: 'experiments array is required' })
    }
    try {
      const out = await applyAssetAbRecommendations(request.workspace_id, {
        experiments,
        dry_run: Boolean(body.dry_run),
        max_applies: body.max_applies,
      })
      return reply.send(out)
    } catch (err) {
      const sc = err.statusCode && Number(err.statusCode) >= 400 && Number(err.statusCode) < 600 ? err.statusCode : 500
      return reply.code(sc).send({ error: err.message })
    }
  })

  // POST /api/ads/competitive-analysis — §9.5 scrape + Ads Library + LLM brief
  app.post('/ads/competitive-analysis', { preHandler: [authenticate] }, async (request, reply) => {
    const body = request.body || {}
    try {
      const out = await runCompetitiveAnalysis(request.workspace_id, body)
      return reply.send(out)
    } catch (err) {
      const sc = err.statusCode && Number(err.statusCode) >= 400 && Number(err.statusCode) < 600 ? err.statusCode : 500
      return reply.code(sc).send({ error: err.message })
    }
  })

  // GET /api/ads/competitive-analysis/recent
  app.get('/ads/competitive-analysis/recent', { preHandler: [authenticate] }, async (request, reply) => {
    const limit = Math.min(50, Math.max(1, Number(request.query?.limit) || 10))
    const items = await listRecentCompetitiveAnalyses(request.workspace_id, { limit })
    return reply.send({ items })
  })

  // GET /api/ads/leads/attribution — §9.6 multi-touch UTM summary
  app.get('/ads/leads/attribution', { preHandler: [authenticate] }, async (request, reply) => {
    const days = Math.min(365, Math.max(7, Number(request.query?.days) || 90))
    const model = String(request.query?.model || 'first_touch')
    const out = await summarizeLeadAttribution(request.workspace_id, { days, model })
    return reply.send(out)
  })

  // ─── GOOGLE ADS SYNC ─────────────────────────────────────────────────────────

  // POST /api/ads/google-ads/sync — enqueue Celery (AI worker → internal API); no inline provider execution in this route
  app.post('/ads/google-ads/sync', { preHandler: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const allAccounts = await Account.findAll(wid)
    const gadsAccount = allAccounts.find(a => a.provider === 'google_ads' && a.authorized)
    if (!gadsAccount) {
      return reply.code(422).send({ error: 'No connected Google Ads account. Connect one via Accounts → Add Account → Google Ads.' })
    }

    try {
      await enqueueCeleryTask('tasks.ads.sync_workspace_on_demand', [wid])
      return reply.code(202).send({ queued: true, account: gadsAccount.name, message: 'Workspace ads sync queued (Celery).' })
    } catch (err) {
      app.log.error(err)
      return reply.code(500).send({ error: err.message })
    }
  })

  // GET /api/ads/google-ads/customers?account_id= — current + list accessible customers
  app.get('/ads/google-ads/customers', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const acc = await resolveGoogleAdsAccount(
        request.workspace_id,
        request.query.account_id || request.query.accountId,
      )
      const { GoogleAdsProvider } = await import('../providers/google_ads.js')
      const { getDecryptedConfig } = await import('../models/Integration.js')
      const config = await getDecryptedConfig('google_ads', request.workspace_id)
      const provider = new GoogleAdsProvider(config, acc)
      const entities = await provider.getEntities()
      return reply.send({
        account_id: String(acc._id),
        customer_id: acc.data?.customer_id || null,
        name: acc.name,
        email: acc.data?.email || null,
        customers: entities,
      })
    } catch (err) {
      return reply.code(err.statusCode || 500).send({ error: err.message })
    }
  })

  // ─── KEYWORDS ───────────────────────────────────────────────────────────────

  // POST /api/ads/keywords/suggest — LLM seeds + Google Keyword Planner (when account linked)
  app.post('/ads/keywords/suggest', { preHandler: [authenticate] }, async (request, reply) => {
    const { topic, language = 'en', country = 'US', account_id: accountIdBody, page_url: pageUrl } = request.body || {}
    if (!topic) return reply.code(422).send({ error: 'topic is required' })

    try {
      const accountId = await pickGoogleAdsAccountId(request.workspace_id, accountIdBody)
      const json = await enqueueCeleryAndWaitForJson(
        'tasks.ads.suggest_keywords',
        [
          String(topic),
          String(country || 'US'),
          String(language || 'en'),
          String(request.workspace_id),
          accountId,
          pageUrl ? String(pageUrl) : null,
        ],
        { timeoutMs: 120000 },
      )
      if (!json.ok) {
        return reply.code(422).send({ error: json.error || 'Keyword suggestion failed' })
      }
      const data = json.data || {}
      try {
        await getDb().collection('ads_keyword_research').insertOne({
          workspace_id: request.workspace_id,
          topic: data.topic || topic,
          language: data.language || language,
          country: data.country || country,
          page_url: pageUrl || null,
          suggestions: data.suggestions || [],
          source: data.source || 'llm',
          created_at: new Date(),
        })
      } catch {
        // non-fatal audit trail
      }
      return reply.send({
        topic: data.topic || topic,
        language: data.language || language,
        country: data.country || country,
        suggestions: data.suggestions || [],
        source: data.source || 'llm',
      })
    } catch (err) {
      const sc = err.statusCode && Number(err.statusCode) >= 400 && Number(err.statusCode) < 600 ? err.statusCode : 500
      return reply.code(sc).send({ error: err.message })
    }
  })

  // ─── CAMPAIGN AI ACTIONS ──────────────────────────────────────────────────

  // POST /api/ads/campaigns/:campaignId/generate-assets
  app.post('/ads/campaigns/:campaignId/generate-assets', { preHandler: [authenticate] }, async (request, reply) => {
    const c = await Campaign.findByUuid(request.params.campaignId, request.workspace_id) || await Campaign.findById(request.params.campaignId, request.workspace_id)
    if (!c) return reply.code(404).send({ error: 'Campaign not found' })

    const language = String(request.body?.language || c.language || 'en')
    try {
      const json = await enqueueCeleryAndWaitForJson(
        'tasks.generate_campaign_assets',
        [
          c._id.toString(),
          c.name,
          c.keywords || [],
          String(request.workspace_id),
          language,
        ],
        { timeoutMs: 120000 },
      )
      if (!json.ok) {
        return reply.code(422).send({ error: json.error || 'Asset generation failed' })
      }
      const assets = {
        headlines: json.data?.headlines || [],
        descriptions: json.data?.descriptions || [],
        source: json.data?.source || 'llm',
      }
      await Campaign.updateCampaign(c._id.toString(), { assets })
      return reply.send({
        campaignId: c._id.toString(),
        assets,
        status: 'complete',
        source: assets.source,
      })
    } catch (err) {
      const sc = err.statusCode && Number(err.statusCode) >= 400 && Number(err.statusCode) < 600 ? err.statusCode : 500
      return reply.code(sc).send({ error: err.message })
    }
  })

  // POST /api/ads/campaigns/:campaignId/generate-landing-page — thin wrapper on landing page workflow
  app.post('/ads/campaigns/:campaignId/generate-landing-page', { preHandler: [authenticate] }, async (request, reply) => {
    const c = await Campaign.findByUuid(request.params.campaignId, request.workspace_id) || await Campaign.findById(request.params.campaignId, request.workspace_id)
    if (!c) return reply.code(404).send({ error: 'Campaign not found' })

    try {
      const out = await runLandingPageWorkflow({
        workspace_id: request.workspace_id,
        title: c.name,
        campaign_id: c._id.toString(),
        language: String(request.body?.language || c.language || 'en'),
        keywords: c.keywords || [],
        publish: Boolean(request.body?.publish),
        async_content: Boolean(request.body?.async),
      })
      return reply.code(201).send({
        landingPageId: out.landing_page?.id,
        slug: out.slug,
        url: out.url,
        content: out.content,
        status: out.status === 'published' ? 'complete' : out.status,
        source: out.content?.source || out.landing_page?.meta?.source || 'llm',
      })
    } catch (err) {
      const sc = err.statusCode && Number(err.statusCode) >= 400 && Number(err.statusCode) < 600 ? err.statusCode : 500
      return reply.code(sc).send({ error: err.message })
    }
  })

  // POST /api/ads/landing-pages/workflow — create → generate copy → publish → lead capture
  app.post('/ads/landing-pages/workflow', { preHandler: [authenticate] }, async (request, reply) => {
    const body = request.body || {}
    try {
      const out = await runLandingPageWorkflow({
        workspace_id: request.workspace_id,
        title: body.title,
        slug: body.slug,
        campaign_id: body.campaign_id,
        language: body.language,
        keywords: body.keywords,
        offer: body.offer,
        audience: body.audience,
        tone: body.tone,
        business: body.business,
        publish: Boolean(body.publish),
        async_content: Boolean(body.async),
      })
      return reply.code(201).send(out)
    } catch (err) {
      const sc = err.statusCode && Number(err.statusCode) >= 400 && Number(err.statusCode) < 600 ? err.statusCode : 500
      return reply.code(sc).send({ error: err.message })
    }
  })

  // POST /api/ads/negative-keywords/suggest — query report negatives (persists to ads_keyword_research)
  app.post('/ads/negative-keywords/suggest', { preHandler: [authenticate] }, async (request, reply) => {
    const body = request.body || {}
    const campaignId = body.campaign_id
    if (campaignId) {
      const c = await Campaign.findById(campaignId, request.workspace_id)
        || await Campaign.findByUuid(campaignId, request.workspace_id)
      if (!c) return reply.code(404).send({ error: 'Campaign not found' })
      try {
        const out = await suggestAndPersistForCampaign(request.workspace_id, c, body)
        return reply.send(out)
      } catch (err) {
        const sc = err.statusCode && Number(err.statusCode) >= 400 && Number(err.statusCode) < 600 ? err.statusCode : 500
        return reply.code(sc).send({ error: err.message })
      }
    }

    try {
      const data = await suggestNegativeKeywords({
        workspace_id: request.workspace_id,
        account_id: body.account_id,
        platform_campaign_id: body.platform_campaign_id,
        min_cost: body.min_cost,
        date_range: body.date_range,
      })
      const suggestions = data.suggestions || data.negatives || data.keywords || []
      await persistNegativeKeywordSuggestions({
        workspace_id: request.workspace_id,
        campaign_id: body.campaign_id,
        account_id: body.account_id,
        platform_campaign_id: body.platform_campaign_id,
        suggestions,
        source: data.source,
      })
      return reply.send({ ok: true, count: suggestions.length, suggestions, source: data.source })
    } catch (err) {
      const sc = err.statusCode && Number(err.statusCode) >= 400 && Number(err.statusCode) < 600 ? err.statusCode : 500
      return reply.code(sc).send({ error: err.message })
    }
  })

  // GET /api/ads/negative-keywords/recent
  app.get('/ads/negative-keywords/recent', { preHandler: [authenticate] }, async (request, reply) => {
    const limit = Math.min(50, Math.max(1, Number(request.query?.limit) || 10))
    const rows = await getDb().collection('ads_keyword_research').find({
      workspace_id: request.workspace_id,
      kind: 'negative_keyword_suggestions',
    }).sort({ created_at: -1 }).limit(limit).toArray()
    return reply.send({
      items: rows.map((r) => ({
        id: r._id.toString(),
        campaign_id: r.campaign_id,
        platform_campaign_id: r.platform_campaign_id,
        count: (r.suggestions || []).length,
        suggestions: r.suggestions || [],
        source: r.source,
        created_at: r.created_at,
      })),
    })
  })

  // POST /api/ads/campaigns/:campaignId/optimize
  app.post('/ads/campaigns/:campaignId/optimize', { preHandler: [authenticate] }, async (request, reply) => {
    const c = await Campaign.findByUuid(request.params.campaignId, request.workspace_id) || await Campaign.findById(request.params.campaignId, request.workspace_id)
    if (!c) return reply.code(404).send({ error: 'Campaign not found' })

    await enqueueOptimizeCampaign(c._id.toString())

    const eventsChannel = process.env.EVENTS_CHANNEL || 'agent_market:events'
    getRedis().publish(eventsChannel, JSON.stringify({ event: 'campaign.optimize_requested', campaignId: c._id.toString() }))

    return reply.send({
      campaignId: c._id.toString(),
      status: 'optimization_queued',
      message: 'Optimization queued — Celery worker will process it shortly',
    })
  })

  // ─── META ADS SYNC ────────────────────────────────────────────────────────────

  // POST /api/ads/meta/sync — enqueue Celery (same engine as daily sync); optional ad_account_id persisted on the account
  app.post('/ads/meta/sync', { preHandler: [authenticate] }, async (request, reply) => {
    const body = request.body || {}
    const ad_account_id = body.ad_account_id ?? request.query?.ad_account_id
    const wid = request.workspace_id
    const allAccounts = await Account.findAll(wid)
    const metaAccount = allAccounts.find(a => (a.provider === 'meta_ads' || a.provider === 'facebook') && a.authorized)
    if (!metaAccount) return reply.code(422).send({ error: 'No connected Meta Ads account. Connect one via Accounts → Add Account → Meta Ads.' })

    if (ad_account_id) {
      await Account.updateAccount(metaAccount._id.toString(), {
        data: { ...(metaAccount.data || {}), ad_account_id },
      })
    }
    const accountId = ad_account_id || metaAccount.data?.ad_account_id
    if (!accountId) {
      return reply.code(422).send({ error: 'ad_account_id required — provide it in the request body or configure it on the Meta account.' })
    }

    try {
      await enqueueCeleryTask('tasks.ads.sync_workspace_on_demand', [wid])
      return reply.code(202).send({
        queued: true,
        account: metaAccount.name,
        ad_account_id: accountId,
        message: 'Workspace ads sync queued (Celery).',
      })
    } catch (err) {
      app.log.error(err)
      return reply.code(500).send({ error: err.message })
    }
  })

  // ─── GOOGLE ADS ENHANCED REPORTING ──────────────────────────────────────────

  /** Resolve Google Ads account; auto-bind customer_id when exactly one accessible customer. */
  async function resolveGoogleAdsAccount(workspaceId, accountIdQuery) {
    const allAccounts = await Account.findAll(workspaceId, { kind: 'ads' })
    let gadsAccount = null
    if (accountIdQuery) {
      const id = String(accountIdQuery).trim()
      gadsAccount = allAccounts.find(
        (a) => a.provider === 'google_ads' && a.authorized && String(a._id) === id,
      )
      if (!gadsAccount) {
        throw Object.assign(new Error('Google Ads account not found'), { statusCode: 404 })
      }
    } else {
      gadsAccount = allAccounts.find((a) => a.provider === 'google_ads' && a.authorized)
    }
    if (!gadsAccount) {
      throw Object.assign(new Error('No connected Google Ads account'), { statusCode: 422 })
    }

    const cid = gadsAccount.data?.customer_id
    if (cid && String(cid).replace(/\D/g, '')) {
      return gadsAccount
    }

    const { GoogleAdsProvider } = await import('../providers/google_ads.js')
    const { getDecryptedConfig } = await import('../models/Integration.js')
    const config = await getDecryptedConfig('google_ads', workspaceId)
    const provider = new GoogleAdsProvider(config, gadsAccount)
    const entities = await provider.getEntities()

    if (entities.length === 1) {
      const picked = entities[0]
      const customerId = String(picked.customer_id || picked.id).replace(/\D/g, '')
      const updated = await Account.updateAccount(gadsAccount._id.toString(), {
        data: { ...(gadsAccount.data || {}), customer_id: customerId, currency: picked.currency || null },
        name: picked.name || gadsAccount.name,
        pending_entities: false,
      })
      return updated
    }

    if (entities.length === 0) {
      throw Object.assign(
        new Error(
          'No accessible Google Ads customer accounts for this login. Check developer token and account access.',
        ),
        { statusCode: 422 },
      )
    }

    const err = Object.assign(
      new Error(
        'Select a Google Ads customer account under Accounts (reconnect or pick a customer).',
      ),
      { statusCode: 422, code: 'GOOGLE_CUSTOMER_REQUIRED', customers: entities },
    )
    throw err
  }

  async function resolveGoogleProvider(workspaceId, accountIdQuery) {
    const { GoogleAdsProvider } = await import('../providers/google_ads.js')
    const { getDecryptedConfig } = await import('../models/Integration.js')
    const gadsAccount = await resolveGoogleAdsAccount(workspaceId, accountIdQuery)
    const config = await getDecryptedConfig('google_ads', workspaceId)
    return new GoogleAdsProvider(config, gadsAccount)
  }

  async function resolveGoogleAdsAccountId(workspaceId, accountIdQuery) {
    const acc = await resolveGoogleAdsAccount(workspaceId, accountIdQuery)
    return acc ? String(acc._id) : null
  }

  function mapGoogleReportingError(err) {
    if (err?.statusCode && Number(err.statusCode) >= 400 && Number(err.statusCode) < 600) {
      return err
    }
    const msg = String(err?.message || err || 'Google Ads reporting failed')
    const e = new Error(msg)
    if (/customer_id|customer id|reconnect|refresh token|developer token|not authorized/i.test(msg)) {
      e.statusCode = 422
    } else if (/timeout/i.test(msg)) {
      e.statusCode = 504
    } else {
      e.statusCode = 502
    }
    return e
  }

  async function runGoogleAdsReporting(request, reply, operation, payload) {
    const accountIdQuery = request.query.account_id || request.query.accountId || null
    let accountId
    try {
      accountId = await resolveGoogleAdsAccountId(request.workspace_id, accountIdQuery)
    } catch (err) {
      const sc = err.statusCode || 422
      const body = { error: err.message }
      if (err.code) body.code = err.code
      if (err.customers) body.customers = err.customers
      return reply.code(sc).send(body)
    }
    if (!accountId) {
      return reply.code(422).send({ error: 'No connected Google Ads account' })
    }
    try {
      const json = await enqueueCeleryAndWaitForJson(
        'tasks.ads.google_ads_reporting_read',
        [String(request.workspace_id), accountId, operation, payload],
        { timeoutMs: 120000 },
      )
      if (!json.ok) {
        const sc = Number(json.status) || 502
        return reply
          .code(Number.isFinite(sc) && sc >= 400 && sc < 600 ? sc : 502)
          .send({ error: json.error || 'Worker error' })
      }
      const d = json.data || {}
      if (d.response_type === 'object') return reply.send(d.payload || {})
      return reply.send({ items: d.payload || [] })
    } catch (err) {
      const mapped = mapGoogleReportingError(err)
      const sc = mapped.statusCode || 502
      return reply.code(sc).send({ error: mapped.message })
    }
  }

  // GET /api/ads/google/performance?date_range=LAST_30_DAYS&campaign_id=X
  app.get('/ads/google/performance', { preHandler: [authenticate] }, async (request, reply) => {
    const { date_range = 'LAST_30_DAYS', campaign_id, include_removed } = request.query
    return runGoogleAdsReporting(
      request,
      reply,
      'performance',
      {
        date_range,
        campaign_id: campaign_id || null,
        include_removed: include_removed === 'true',
      },
    )
  })

  // GET /api/ads/google/ad-groups?campaign_id=X
  app.get('/ads/google/ad-groups', { preHandler: [authenticate] }, async (request, reply) => {
    const { campaign_id, status } = request.query
    return runGoogleAdsReporting(
      request,
      reply,
      'ad_groups',
      { campaign_id: campaign_id || null, status: status || null },
    )
  })

  // GET /api/ads/google/keywords?campaign_id=X&ad_group_id=X&date_range=X
  app.get('/ads/google/keywords', { preHandler: [authenticate] }, async (request, reply) => {
    const { date_range = 'LAST_30_DAYS', campaign_id, ad_group_id, min_impressions = 0 } = request.query
    return runGoogleAdsReporting(
      request,
      reply,
      'keywords',
      {
        date_range,
        campaign_id: campaign_id || null,
        ad_group_id: ad_group_id || null,
        min_impressions: parseInt(min_impressions, 10) || 0,
      },
    )
  })

  // GET /api/ads/google/ads?campaign_id=X&ad_group_id=X&date_range=X
  app.get('/ads/google/ads', { preHandler: [authenticate] }, async (request, reply) => {
    const { date_range = 'LAST_30_DAYS', campaign_id, ad_group_id } = request.query
    return runGoogleAdsReporting(
      request,
      reply,
      'ads',
      {
        date_range,
        campaign_id: campaign_id || null,
        ad_group_id: ad_group_id || null,
      },
    )
  })

  // GET /api/ads/google/search-terms?campaign_id=X&date_range=X&min_impressions=X
  app.get('/ads/google/search-terms', { preHandler: [authenticate] }, async (request, reply) => {
    const { date_range = 'LAST_30_DAYS', campaign_id, ad_group_id, min_impressions = 0 } = request.query
    return runGoogleAdsReporting(
      request,
      reply,
      'search_terms',
      {
        date_range,
        campaign_id: campaign_id || null,
        ad_group_id: ad_group_id || null,
        min_impressions: parseInt(min_impressions, 10) || 0,
      },
    )
  })

  // GET /api/ads/google/account-summary?date_range=X
  app.get('/ads/google/account-summary', { preHandler: [authenticate] }, async (request, reply) => {
    const { date_range = 'LAST_30_DAYS' } = request.query
    return runGoogleAdsReporting(
      request,
      reply,
      'account_summary',
      { date_range },
    )
  })

  // GET /api/ads/google/daily?date_range=X&campaign_id=X — daily spend/clicks series
  app.get('/ads/google/daily', { preHandler: [authenticate] }, async (request, reply) => {
    const { date_range = 'LAST_30_DAYS', campaign_id } = request.query
    return runGoogleAdsReporting(
      request,
      reply,
      'daily',
      {
        date_range,
        campaign_id: campaign_id || null,
      },
    )
  })

  // POST /api/ads/google/query — run arbitrary GAQL
  app.post('/ads/google/query', { preHandler: [authenticate] }, async (request, reply) => {
    const { query } = request.body || {}
    if (!query) return reply.code(422).send({ error: 'query is required' })
    return runGoogleAdsReporting(request, reply, 'gaql', { query })
  })

  async function resolveMetaAdsAccountId(workspaceId) {
    const allAccounts = await Account.findAll(workspaceId)
    const a = allAccounts.find((x) => (x.provider === 'meta_ads' || x.provider === 'facebook') && x.authorized)
    return a ? String(a._id) : null
  }

  /**
   * Meta reporting reads — always worker registry tools (``meta_list_adsets``, ``meta_list_ads``, ``meta_report_insights``).
   */
  function parseCsvQueryArray(val) {
    if (val == null || val === '') return undefined
    const s = String(val).trim()
    if (s === '[]' || s === '__empty__') return []
    return s.split(',').map((x) => x.trim()).filter(Boolean)
  }

  async function runMetaAdsReporting(request, reply, operation, payload) {
    const accountId =
      (request.query?.account_id && String(request.query.account_id)) ||
      (payload?.account_id && String(payload.account_id)) ||
      (await resolveMetaAdsAccountId(request.workspace_id))
    if (!accountId) {
      return reply.code(422).send({ error: 'No connected Meta Ads account' })
    }
    try {
      const json = await enqueueCeleryAndWaitForJson(
        'tasks.ads.meta_ads_reporting_read',
        [String(request.workspace_id), accountId, operation, payload],
        { timeoutMs: 120000 },
      )
      if (!json.ok) {
        const sc = Number(json.status) || 502
        return reply
          .code(Number.isFinite(sc) && sc >= 400 && sc < 600 ? sc : 502)
          .send({ error: json.error || 'Worker error' })
      }
      const body = (json.data && json.data.result) || { data: [], paging: undefined }
      return reply.send(body)
    } catch (err) {
      const sc =
        err.statusCode && Number(err.statusCode) >= 400 && Number(err.statusCode) < 600
          ? err.statusCode
          : 500
      return reply.code(sc).send({ error: err.message })
    }
  }

  // ─── META ADS ENHANCED REPORTING ────────────────────────────────────────────

  // GET /api/ads/meta/campaigns?ad_account_id=act_X — worker tool meta_list_campaigns
  app.get('/ads/meta/campaigns', { preHandler: [authenticate] }, async (request, reply) => {
    const { ad_account_id, limit = 100, after, status_filter, objective_filter } = request.query
    if (!ad_account_id) {
      return reply.code(422).send({ error: 'ad_account_id is required' })
    }
    return runMetaAdsReporting(request, reply, 'campaigns', {
      ad_account_id,
      limit: parseInt(limit, 10) || 100,
      after: after || null,
      status_filter: status_filter || null,
      objective_filter: objective_filter || null,
    })
  })

  // GET /api/ads/meta/ad-sets?campaign_id=X — worker tool meta_list_adsets (reference get_adsets)
  app.get('/ads/meta/ad-sets', { preHandler: [authenticate] }, async (request, reply) => {
    const { campaign_id, ad_account_id, limit = 100, after } = request.query
    if (!campaign_id && !ad_account_id) {
      return reply.code(422).send({ error: 'campaign_id or ad_account_id is required' })
    }
    return runMetaAdsReporting(request, reply, 'ad_sets', {
      campaign_id: campaign_id || null,
      ad_account_id: ad_account_id || null,
      limit: parseInt(limit, 10) || 100,
      after: after || null,
    })
  })

  // GET /api/ads/meta/ads — worker tool meta_list_ads (reference get_ads)
  app.get('/ads/meta/ads', { preHandler: [authenticate] }, async (request, reply) => {
    const { ad_set_id, campaign_id, ad_account_id, limit = 100, after } = request.query
    if (!campaign_id && !ad_set_id && !ad_account_id) {
      return reply.code(422).send({ error: 'campaign_id, ad_set_id, or ad_account_id is required' })
    }
    return runMetaAdsReporting(request, reply, 'ads', {
      ad_set_id: ad_set_id || null,
      campaign_id: campaign_id || null,
      ad_account_id: ad_account_id || null,
      limit: parseInt(limit, 10) || 100,
      after: after || null,
    })
  })

  // GET /api/ads/meta/insights — meta_report_insights (full reference get_insights params)
  app.get('/ads/meta/insights', { preHandler: [authenticate] }, async (request, reply) => {
    const {
      object_id,
      time_range = 'last_30d',
      breakdown,
      level = 'campaign',
      limit = 100,
      after,
      since,
      until,
      compact,
      api_version,
      action_attribution_windows: attrWindows,
      action_breakdowns: actionBreakdowns,
      time_increment,
    } = request.query
    if (!object_id) return reply.code(422).send({ error: 'object_id is required' })
    const resolvedTimeRange = since && until ? { since, until } : time_range
    const payload = {
      object_id,
      time_range: resolvedTimeRange,
      breakdown: breakdown || null,
      level: level || null,
      limit: parseInt(limit, 10) || 100,
      after: after || null,
      time_increment: time_increment || null,
    }
    const parsedAttr = parseCsvQueryArray(attrWindows)
    if (parsedAttr !== undefined) payload.action_attribution_windows = parsedAttr
    const parsedActBd = parseCsvQueryArray(actionBreakdowns)
    if (parsedActBd !== undefined) payload.action_breakdowns = parsedActBd
    if (compact === '1' || compact === 'true') payload.compact = true
    if (api_version) payload.api_version = String(api_version)
    return runMetaAdsReporting(request, reply, 'insights', payload)
  })
}
