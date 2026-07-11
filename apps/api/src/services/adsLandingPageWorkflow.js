/**
 * Landing page workflow — create → AI copy → publish → lead capture (public /lp/:slug).
 * Shared by UI, campaign routes, agent tool, and worker internal API.
 */
import * as LandingPage from '../models/LandingPage.js'
import * as Campaign from '../models/Campaign.js'
import { enqueueCeleryAndWaitForJson } from '../lib/p2ExecCeleryReply.js'
import { publishEvent } from '../lib/events.js'
import { enqueueLandingPageContentGeneration } from '../lib/adsQueues.js'

const DEFAULT_FORM_FIELDS = [
  { name: 'name', label: 'Full name', type: 'text', required: true },
  { name: 'email', label: 'Email', type: 'email', required: true },
  { name: 'phone', label: 'Phone', type: 'tel', required: false },
]

export async function generateLandingPageCopy({
  landingPageId,
  campaignName,
  workspaceId,
  keywords = [],
  language = 'en',
}) {
  const json = await enqueueCeleryAndWaitForJson(
    'tasks.generate_landing_page_content',
    [landingPageId, campaignName, String(workspaceId), keywords, language],
    { timeoutMs: 120000 },
  )
  if (!json.ok) {
    throw Object.assign(new Error(json.error || 'Landing page generation failed'), { statusCode: 422 })
  }
  const content = json.data || {}
  const updated = await LandingPage.updateLandingPage(landingPageId, {
    headline: content.headline,
    subheadline: content.subheadline,
    body: content.body,
    cta_text: content.cta_text,
    meta: { generated: true, campaignName, source: content.source || 'llm', pendingContent: false },
  })
  return { content, landing_page: LandingPage.serialize(updated) }
}

/**
 * Full workflow: draft page → generate copy → optional publish.
 * @param {{ async_content?: boolean }} options — enqueue Celery generation when true
 */
function buildCopyBrief({ title, offer, audience, tone, business }) {
  return [
    title?.trim(),
    offer && `Offer: ${offer}`,
    audience && `Audience: ${audience}`,
    tone && `Tone: ${tone}`,
    business && `Business: ${business}`,
  ].filter(Boolean).join('\n')
}

export async function runLandingPageWorkflow({
  workspace_id: workspaceId,
  title,
  slug = null,
  campaign_id: campaignId = null,
  language = 'en',
  keywords = [],
  offer = null,
  audience = null,
  tone = null,
  business = null,
  publish = false,
  async_content: asyncContent = false,
}) {
  if (!workspaceId) throw Object.assign(new Error('workspace_id is required'), { statusCode: 422 })
  if (!title?.trim()) throw Object.assign(new Error('title is required'), { statusCode: 422 })

  let campaign = null
  let kw = keywords
  let lang = language
  if (campaignId) {
    campaign = await Campaign.findById(campaignId, workspaceId)
      || await Campaign.findByUuid(campaignId, workspaceId)
    if (!campaign) throw Object.assign(new Error('Campaign not found'), { statusCode: 404 })
    kw = campaign.keywords || kw
    lang = campaign.language || lang
  }

  const page = await LandingPage.createLandingPage({
    workspace_id: workspaceId,
    campaign_id: campaign?._id?.toString() || campaignId,
    title: title.trim(),
    slug: slug || undefined,
    headline: title.trim(),
    subheadline: '',
    body: '',
    cta_text: 'Get started',
    cta_url: '',
    form_fields: DEFAULT_FORM_FIELDS,
    meta: {
      generated: true,
      campaignName: campaign?.name || title.trim(),
      language: lang,
      pendingContent: true,
      workflow: true,
    },
  })

  const landingPageId = page._id.toString()
  const campaignName = campaign?.name || buildCopyBrief({ title, offer, audience, tone, business }) || title.trim()

  let contentResult = null
  if (asyncContent) {
    await enqueueLandingPageContentGeneration({
      landingPageId,
      campaignName,
      workspaceId,
      keywords: kw,
      language: lang,
    })
  } else {
    contentResult = await generateLandingPageCopy({
      landingPageId,
      campaignName,
      workspaceId,
      keywords: kw,
      language: lang,
    })
  }

  if (publish && !asyncContent) {
    await LandingPage.updateLandingPage(landingPageId, { status: 'published' })
    await publishEvent('landing_page.published', {
      landing_page_id: landingPageId,
      slug: page.slug,
      workspace_id: workspaceId,
    })
  }

  const final = await LandingPage.findById(landingPageId, workspaceId)

  return {
    landing_page: LandingPage.serialize(final),
    slug: page.slug,
    url: `/lp/${page.slug}`,
    lead_capture_url: `/api/ads/landing-pages/${page.slug}/lead`,
    status: asyncContent ? 'content_queued' : (publish ? 'published' : 'draft'),
    content: contentResult?.content || null,
  }
}
