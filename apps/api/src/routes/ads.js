import { authenticate } from '../middleware/auth.js'
import * as Campaign from '../models/Campaign.js'
import * as LandingPage from '../models/LandingPage.js'
import * as Lead from '../models/Lead.js'
import * as Account from '../models/Account.js'
import { getSocialProvider } from '../providers/index.js'

export default async function adsRoutes(app) {

  // ─── CAMPAIGNS ──────────────────────────────────────────────────────────────

  // GET /api/ads/campaigns?userId=wetaxi  (or JWT auth)
  app.get('/ads/campaigns', async (request, reply) => {
    const { userId } = request.query
    // Try JWT first, fall back to userId param
    let workspaceId = userId
    if (!userId) {
      try { await request.jwtVerify(); workspaceId = request.workspace_id } catch { return reply.code(401).send({ error: 'userId query param or auth token required' }) }
    }
    const { status, platform, page, per_page } = request.query
    const result = await Campaign.findAll(workspaceId, { status, platform, page: parseInt(page || 1), per_page: parseInt(per_page || 20) })
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
  app.post('/ads/campaigns', async (request, reply) => {
    const body = request.body || {}
    const { userId, name, goal, budgetDaily, platform, type, budget, start_date, end_date, keywords, targeting } = body

    if (!name) return reply.code(422).send({ error: 'name is required' })

    let workspaceId = userId
    if (!userId) {
      try { await request.jwtVerify(); workspaceId = request.workspace_id } catch { return reply.code(401).send({ error: 'userId in body or auth token required' }) }
    }

    // Map README fields (goal, budgetDaily) to internal fields
    const resolvedPlatform = platform || (goal ? 'google_ads' : null)
    if (!resolvedPlatform) return reply.code(422).send({ error: 'platform or goal is required' })

    const resolvedBudget = budget || (budgetDaily ? { amount: budgetDaily, period: 'daily', currency: 'EUR' } : undefined)

    const c = await Campaign.createCampaign({
      workspace_id: workspaceId,
      name,
      platform: resolvedPlatform,
      goal: goal || null,
      type,
      budget: resolvedBudget,
      start_date,
      end_date,
      keywords,
      targeting,
    })
    return reply.code(201).send(Campaign.serialize(c))
  })

  // PATCH /api/ads/campaigns/:id
  app.patch('/ads/campaigns/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const c = await Campaign.findByUuid(request.params.id, request.workspace_id) || await Campaign.findById(request.params.id, request.workspace_id)
    if (!c) return reply.code(404).send({ error: 'Campaign not found' })
    const updated = await Campaign.updateCampaign(c._id.toString(), request.body || {})
    return reply.send(Campaign.serialize(updated))
  })

  // DELETE /api/ads/campaigns/:id
  app.delete('/ads/campaigns/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const c = await Campaign.findByUuid(request.params.id, request.workspace_id) || await Campaign.findById(request.params.id, request.workspace_id)
    if (!c) return reply.code(404).send({ error: 'Campaign not found' })
    await Campaign.deleteCampaign(c._id.toString())
    return reply.code(204).send()
  })

  // ─── LANDING PAGES ──────────────────────────────────────────────────────────

  // GET /api/ads/landing-pages?userId=wetaxi  (or JWT auth)
  app.get('/ads/landing-pages', async (request, reply) => {
    const { userId, status, page, per_page } = request.query
    let workspaceId = userId
    if (!userId) {
      try { await request.jwtVerify(); workspaceId = request.workspace_id } catch { return reply.code(401).send({ error: 'userId query param or auth token required' }) }
    }
    const result = await LandingPage.findAll(workspaceId, { status, page: parseInt(page || 1), per_page: parseInt(per_page || 20) })
    return reply.send({ ...result, items: result.items.map(LandingPage.serialize) })
  })

  // GET /api/ads/landing-pages/:slug  — public: slug lookup (no auth)
  // Also accessible with ?userId= for context
  app.get('/ads/landing-pages/:slug', async (request, reply) => {
    const p = await LandingPage.findBySlug(request.params.slug)
    if (!p) return reply.code(404).send({ error: 'Landing page not found' })
    return reply.send(LandingPage.serialize(p))
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

  // POST /api/ads/landing-pages/:slug/lead  — public: capture a lead (no auth)
  app.post('/ads/landing-pages/:slug/lead', async (request, reply) => {
    const page = await LandingPage.findBySlug(request.params.slug)
    if (!page) return reply.code(404).send({ error: 'Landing page not found' })

    const { data = {}, utm = {} } = request.body || {}

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
      ip,
      user_agent: request.headers['user-agent'],
    })
    await LandingPage.incrementLeadCount(page._id.toString())
    return reply.code(201).send({ success: true, lead_id: lead.uuid })
  })

  // ─── LEADS ──────────────────────────────────────────────────────────────────

  // GET /api/ads/leads?userId=wetaxi  (or JWT auth)
  app.get('/ads/leads', async (request, reply) => {
    const { userId, landing_page_id, campaign_id, page, per_page } = request.query
    let workspaceId = userId
    if (!userId) {
      try { await request.jwtVerify(); workspaceId = request.workspace_id } catch { return reply.code(401).send({ error: 'userId query param or auth token required' }) }
    }
    const result = await Lead.findAll(workspaceId, { landing_page_id, campaign_id, page: parseInt(page || 1), per_page: parseInt(per_page || 30) })
    return reply.send({ ...result, items: result.items.map(Lead.serialize) })
  })

  // ─── BUDGET / KPI ────────────────────────────────────────────────────────────

  // GET /api/ads/budget-summary
  app.get('/ads/budget-summary', { preHandler: [authenticate] }, async (request, reply) => {
    const campaigns = await Campaign.findAll(request.workspace_id, { per_page: 1000 })
    const items = campaigns.items

    const totalBudget = items.reduce((s, c) => s + (c.budget?.amount || 0), 0)
    const totalSpend = items.reduce((s, c) => s + (c.metrics?.spend || 0), 0)
    const totalImpressions = items.reduce((s, c) => s + (c.metrics?.impressions || 0), 0)
    const totalClicks = items.reduce((s, c) => s + (c.metrics?.clicks || 0), 0)
    const totalConversions = items.reduce((s, c) => s + (c.metrics?.conversions || 0), 0)

    const ctr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : 0
    const cpc = totalClicks > 0 ? (totalSpend / totalClicks).toFixed(2) : 0
    const cpa = totalConversions > 0 ? (totalSpend / totalConversions).toFixed(2) : 0

    const byPlatform = {}
    for (const c of items) {
      const p = c.platform
      if (!byPlatform[p]) byPlatform[p] = { budget: 0, spend: 0, clicks: 0, impressions: 0, conversions: 0 }
      byPlatform[p].budget += c.budget?.amount || 0
      byPlatform[p].spend += c.metrics?.spend || 0
      byPlatform[p].clicks += c.metrics?.clicks || 0
      byPlatform[p].impressions += c.metrics?.impressions || 0
      byPlatform[p].conversions += c.metrics?.conversions || 0
    }

    return reply.send({
      total_budget: totalBudget,
      total_spend: totalSpend,
      budget_remaining: totalBudget - totalSpend,
      total_impressions: totalImpressions,
      total_clicks: totalClicks,
      total_conversions: totalConversions,
      ctr: parseFloat(ctr),
      cpc: parseFloat(cpc),
      cpa: parseFloat(cpa),
      by_platform: byPlatform,
      campaign_count: items.length,
      active_campaigns: items.filter(c => c.status === 'active').length,
    })
  })

  // ─── GOOGLE ADS SYNC ─────────────────────────────────────────────────────────

  // POST /api/ads/google-ads/sync
  app.post('/ads/google-ads/sync', { preHandler: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const allAccounts = await Account.findAll(wid)
    const gadsAccount = allAccounts.find(a => a.provider === 'google_ads' && a.authorized)
    if (!gadsAccount) {
      return reply.code(422).send({ error: 'No connected Google Ads account. Connect one via Accounts → Add Account → Google Ads.' })
    }

    try {
      const provider = await getSocialProvider('google_ads', {}, gadsAccount)
      const remoteCampaigns = await provider.syncCampaigns()
      const db = (await import('../db/mongodb.js')).getDb()
      let upserted = 0

      for (const rc of remoteCampaigns) {
        const filter = { workspace_id: wid, google_campaign_id: rc.google_campaign_id }
        const existing = await db.collection('ads_campaigns').findOne(filter)
        if (existing) {
          await db.collection('ads_campaigns').updateOne(filter, {
            $set: { name: rc.name, status: rc.status, budget: rc.budget, start_date: rc.start_date, end_date: rc.end_date, metrics: rc.metrics, updated_at: new Date() },
          })
        } else {
          const { nanoid } = await import('nanoid')
          await db.collection('ads_campaigns').insertOne({
            uuid: nanoid(), workspace_id: wid, google_campaign_id: rc.google_campaign_id,
            name: rc.name, platform: 'google_ads', type: rc.type, status: rc.status,
            budget: rc.budget, start_date: rc.start_date, end_date: rc.end_date,
            metrics: rc.metrics, keywords: [], targeting: {}, assets: {},
            deleted_at: null, created_at: new Date(), updated_at: new Date(),
          })
        }
        upserted++
      }
      return reply.send({ synced: upserted, account: gadsAccount.name })
    } catch (err) {
      app.log.error(err)
      return reply.code(500).send({ error: err.message })
    }
  })

  // GET /api/ads/google-ads/customers
  app.get('/ads/google-ads/customers', { preHandler: [authenticate] }, async (request, reply) => {
    const allAccounts = await Account.findAll(request.workspace_id)
    const gadsAccount = allAccounts.find(a => a.provider === 'google_ads' && a.authorized)
    if (!gadsAccount) return reply.code(422).send({ error: 'No connected Google Ads account' })
    return reply.send({ customer_id: gadsAccount.data?.customer_id || null, name: gadsAccount.name, email: gadsAccount.data?.email || null })
  })

  // ─── KEYWORDS ───────────────────────────────────────────────────────────────

  // POST /api/ads/keywords/suggest
  app.post('/ads/keywords/suggest', async (request, reply) => {
    const { topic, language = 'fr', country = 'FR' } = request.body || {}
    if (!topic) return reply.code(422).send({ error: 'topic is required' })

    const base = topic.toLowerCase().replace(/\s+/g, '-')
    const suggestions = [
      { keyword: topic, avgMonthlySearches: 1200, competition: 'MEDIUM', cpcMin: 0.45, cpcMax: 1.20 },
      { keyword: `${topic} prix`, avgMonthlySearches: 880, competition: 'HIGH', cpcMin: 0.80, cpcMax: 2.10 },
      { keyword: `${topic} avis`, avgMonthlySearches: 720, competition: 'LOW', cpcMin: 0.30, cpcMax: 0.90 },
      { keyword: `meilleur ${topic}`, avgMonthlySearches: 590, competition: 'MEDIUM', cpcMin: 0.55, cpcMax: 1.40 },
      { keyword: `${topic} pas cher`, avgMonthlySearches: 430, competition: 'LOW', cpcMin: 0.20, cpcMax: 0.70 },
      { keyword: `${base}-en-ligne`, avgMonthlySearches: 310, competition: 'LOW', cpcMin: 0.15, cpcMax: 0.60 },
    ]
    return reply.send({ topic, language, country, suggestions, source: 'stub' })
  })

  // ─── CAMPAIGN AI ACTIONS ──────────────────────────────────────────────────

  // POST /api/ads/campaigns/:campaignId/generate-assets
  app.post('/ads/campaigns/:campaignId/generate-assets', async (request, reply) => {
    const c = await Campaign.findByUuid(request.params.campaignId) || await Campaign.findById(request.params.campaignId)
    if (!c) return reply.code(404).send({ error: 'Campaign not found' })

    const { getRedis: redis } = await import('../db/redis.js')
    const { nanoid: uid } = await import('nanoid')
    const taskId = uid()
    await redis().lpush('celery', JSON.stringify({
      id: taskId,
      task: 'tasks.generate_campaign_assets',
      args: [c._id.toString(), c.name, c.keywords || []],
      kwargs: {}, retries: 0, eta: null, expires: null, utc: true,
      callbacks: null, errbacks: null, timelimit: [null, null], taskset: null, chord: null,
    }))

    const assets = {
      headlines: [`Découvrez ${c.name}`, `${c.name} — Offre Exclusive`, `Profitez de ${c.name} Maintenant`],
      descriptions: [`${c.name} vous offre la meilleure solution. Contactez-nous dès aujourd'hui.`, `Rejoignez des milliers de clients satisfaits. Essayez ${c.name} gratuitement.`],
    }
    await Campaign.updateCampaign(c._id.toString(), { assets })
    return reply.send({ campaignId: c._id.toString(), assets, taskId, status: 'queued' })
  })

  // POST /api/ads/campaigns/:campaignId/generate-landing-page
  app.post('/ads/campaigns/:campaignId/generate-landing-page', async (request, reply) => {
    const c = await Campaign.findByUuid(request.params.campaignId) || await Campaign.findById(request.params.campaignId)
    if (!c) return reply.code(404).send({ error: 'Campaign not found' })

    const { nanoid: uid } = await import('nanoid')
    const slug = `${c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${uid(6)}`

    const landingPage = await LandingPage.createLandingPage({
      workspace_id: c.workspace_id,
      campaign_id: c._id.toString(),
      title: c.name,
      slug,
      headline: `Bienvenue sur ${c.name}`,
      subheadline: 'La solution idéale pour booster votre croissance',
      body: `Découvrez comment ${c.name} peut transformer votre activité. Nos experts sont à votre disposition pour vous accompagner.`,
      cta_text: 'Commencer maintenant',
      cta_url: '',
      form_fields: [
        { name: 'name', label: 'Nom complet', type: 'text', required: true },
        { name: 'email', label: 'Email', type: 'email', required: true },
        { name: 'phone', label: 'Téléphone', type: 'tel', required: false },
      ],
      meta: { generated: true, campaignName: c.name },
    })

    const { getRedis: redis } = await import('../db/redis.js')
    const taskId = uid()
    await redis().lpush('celery', JSON.stringify({
      id: taskId,
      task: 'tasks.generate_landing_page_content',
      args: [landingPage._id.toString(), c.name],
      kwargs: {}, retries: 0, eta: null, expires: null, utc: true,
      callbacks: null, errbacks: null, timelimit: [null, null], taskset: null, chord: null,
    }))

    return reply.code(201).send({ landingPageId: landingPage._id.toString(), slug, url: `/lp/${slug}`, taskId, status: 'queued' })
  })

  // POST /api/ads/campaigns/:campaignId/optimize
  app.post('/ads/campaigns/:campaignId/optimize', async (request, reply) => {
    const c = await Campaign.findByUuid(request.params.campaignId) || await Campaign.findById(request.params.campaignId)
    if (!c) return reply.code(404).send({ error: 'Campaign not found' })

    const { getRedis: redis } = await import('../db/redis.js')
    const { nanoid: uid } = await import('nanoid')
    const taskId = uid()

    await redis().lpush('celery', JSON.stringify({
      id: taskId,
      task: 'tasks.optimize_campaign',
      args: [c._id.toString()],
      kwargs: {}, retries: 0, eta: null, expires: null, utc: true,
      callbacks: null, errbacks: null, timelimit: [null, null], taskset: null, chord: null,
    }))

    const eventsChannel = process.env.EVENTS_CHANNEL || 'agent_market:events'
    redis().publish(eventsChannel, JSON.stringify({ event: 'campaign.optimize_requested', campaignId: c._id.toString() }))

    return reply.send({ campaignId: c._id.toString(), taskId, status: 'optimization_queued', message: 'Optimization task queued for AI worker' })
  })
}
