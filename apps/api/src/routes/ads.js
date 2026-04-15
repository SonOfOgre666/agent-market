import { authenticate } from '../middleware/auth.js'
import * as Campaign from '../models/Campaign.js'
import * as LandingPage from '../models/LandingPage.js'
import * as Lead from '../models/Lead.js'
import * as Account from '../models/Account.js'
import { getSocialProvider } from '../providers/index.js'

export default async function adsRoutes(app) {

  // ─── CAMPAIGNS ──────────────────────────────────────────────────────────────

  // GET /api/ads/campaigns
  app.get('/ads/campaigns', { preHandler: [authenticate] }, async (request, reply) => {
    const { status, platform, page, per_page } = request.query
    const result = await Campaign.findAll(request.workspace_id, { status, platform, page: parseInt(page || 1), per_page: parseInt(per_page || 20) })
    return reply.send({ ...result, items: result.items.map(Campaign.serialize) })
  })

  // GET /api/ads/campaigns/:id
  app.get('/ads/campaigns/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const c = await Campaign.findByUuid(request.params.id, request.workspace_id) || await Campaign.findById(request.params.id, request.workspace_id)
    if (!c) return reply.code(404).send({ error: 'Campaign not found' })
    return reply.send(Campaign.serialize(c))
  })

  // POST /api/ads/campaigns
  app.post('/ads/campaigns', { preHandler: [authenticate] }, async (request, reply) => {
    const { name, platform, type, budget, start_date, end_date, keywords, targeting } = request.body || {}
    if (!name) return reply.code(422).send({ error: 'name is required' })
    if (!platform) return reply.code(422).send({ error: 'platform is required' })
    const c = await Campaign.createCampaign({ workspace_id: request.workspace_id, name, platform, type, budget, start_date, end_date, keywords, targeting })
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

  // GET /api/ads/landing-pages
  app.get('/ads/landing-pages', { preHandler: [authenticate] }, async (request, reply) => {
    const { status, page, per_page } = request.query
    const result = await LandingPage.findAll(request.workspace_id, { status, page: parseInt(page || 1), per_page: parseInt(per_page || 20) })
    return reply.send({ ...result, items: result.items.map(LandingPage.serialize) })
  })

  // GET /api/ads/landing-pages/slug/:slug  — public, no auth required
  app.get('/ads/landing-pages/slug/:slug', async (request, reply) => {
    const p = await LandingPage.findBySlug(request.params.slug)
    if (!p) return reply.code(404).send({ error: 'Landing page not found' })
    return reply.send(LandingPage.serialize(p))
  })

  // GET /api/ads/landing-pages/:id
  app.get('/ads/landing-pages/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const p = await LandingPage.findById(request.params.id, request.workspace_id)
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

  // PATCH /api/ads/landing-pages/:id
  app.patch('/ads/landing-pages/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const p = await LandingPage.findById(request.params.id, request.workspace_id)
    if (!p) return reply.code(404).send({ error: 'Landing page not found' })
    const updated = await LandingPage.updateLandingPage(p._id.toString(), request.body || {})
    return reply.send(LandingPage.serialize(updated))
  })

  // DELETE /api/ads/landing-pages/:id
  app.delete('/ads/landing-pages/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const p = await LandingPage.findById(request.params.id, request.workspace_id)
    if (!p) return reply.code(404).send({ error: 'Landing page not found' })
    await LandingPage.deleteLandingPage(p._id.toString())
    return reply.code(204).send()
  })

  // POST /api/ads/landing-pages/:slug/lead  — public: capture a lead (no auth)
  app.post('/ads/landing-pages/:slug/lead', async (request, reply) => {
    const page = await LandingPage.findBySlug(request.params.slug)
    if (!page) return reply.code(404).send({ error: 'Landing page not found' })

    const { data = {}, utm = {} } = request.body || {}

    // Basic validation: check required fields
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

  // GET /api/ads/leads
  app.get('/ads/leads', { preHandler: [authenticate] }, async (request, reply) => {
    const { landing_page_id, campaign_id, page, per_page } = request.query
    const result = await Lead.findAll(request.workspace_id, { landing_page_id, campaign_id, page: parseInt(page || 1), per_page: parseInt(per_page || 30) })
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
  // Pulls campaigns + metrics from Google Ads API and upserts them locally
  app.post('/ads/google-ads/sync', { preHandler: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id

    // Find connected Google Ads account for this workspace
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
        // Upsert by google_campaign_id + workspace_id
        const filter = { workspace_id: wid, google_campaign_id: rc.google_campaign_id }
        const existing = await db.collection('ads_campaigns').findOne(filter)

        if (existing) {
          await db.collection('ads_campaigns').updateOne(filter, {
            $set: {
              name: rc.name,
              status: rc.status,
              budget: rc.budget,
              start_date: rc.start_date,
              end_date: rc.end_date,
              metrics: rc.metrics,
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
            start_date: rc.start_date,
            end_date: rc.end_date,
            metrics: rc.metrics,
            keywords: [],
            targeting: {},
            assets: {},
            deleted_at: null,
            created_at: new Date(),
            updated_at: new Date(),
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
  // Lists accessible Google Ads customer IDs for the connected account
  app.get('/ads/google-ads/customers', { preHandler: [authenticate] }, async (request, reply) => {
    const allAccounts = await Account.findAll(request.workspace_id)
    const gadsAccount = allAccounts.find(a => a.provider === 'google_ads' && a.authorized)
    if (!gadsAccount) return reply.code(422).send({ error: 'No connected Google Ads account' })

    return reply.send({
      customer_id: gadsAccount.data?.customer_id || null,
      name: gadsAccount.name,
      email: gadsAccount.data?.email || null,
    })
  })
}
