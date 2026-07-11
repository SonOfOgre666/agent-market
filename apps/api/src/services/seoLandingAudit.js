/**
 * ONBOARDING §9.3 (lightweight) — technical SEO audit on published landing pages in Mongo.
 * No external crawler; checks on-page fields we control.
 */
import * as LandingPage from '../models/LandingPage.js'

function auditOne(page) {
  const issues = []
  const headline = (page.headline || '').trim()
  const body = (page.body || '').trim()
  const sub = (page.subheadline || '').trim()
  const title = (page.title || '').trim()

  if (!headline || headline.length < 10) {
    issues.push({ type: 'weak_headline', severity: 'high', message: 'Headline missing or too short (< 10 chars)' })
  }
  if (headline.length > 70) {
    issues.push({ type: 'long_headline', severity: 'medium', message: 'Headline may truncate in SERP snippets (> 70 chars)' })
  }
  if (!sub) {
    issues.push({ type: 'missing_subheadline', severity: 'low', message: 'No subheadline — add supporting copy' })
  }
  if (body.length < 80) {
    issues.push({ type: 'thin_content', severity: 'high', message: 'Body copy is thin (< 80 chars)' })
  }
  if (!title || title === headline) {
    issues.push({ type: 'title_equals_headline', severity: 'low', message: 'Page title should differ from H1 for SEO variety' })
  }
  if (!(page.form_fields || []).length) {
    issues.push({ type: 'no_form', severity: 'medium', message: 'No lead capture form configured' })
  }
  if (page.status !== 'published') {
    issues.push({ type: 'not_published', severity: 'medium', message: 'Page is not published' })
  }

  return {
    id: page._id?.toString(),
    slug: page.slug,
    title: page.title,
    status: page.status,
    issue_count: issues.length,
    issues,
    score: Math.max(0, 100 - issues.filter((i) => i.severity === 'high').length * 25
      - issues.filter((i) => i.severity === 'medium').length * 10
      - issues.filter((i) => i.severity === 'low').length * 5),
  }
}

export async function auditWorkspaceLandingPages(workspaceId) {
  const { items } = await LandingPage.findAll(workspaceId, { per_page: 500 })
  const audited = items.map(auditOne)
  const avgScore = audited.length
    ? Math.round(audited.reduce((s, a) => s + a.score, 0) / audited.length)
    : null

  return {
    workspace_id: String(workspaceId),
    page_count: audited.length,
    average_score: avgScore,
    pages: audited.sort((a, b) => a.score - b.score),
    summary: {
      critical: audited.filter((p) => p.issues.some((i) => i.severity === 'high')).length,
      needs_work: audited.filter((p) => p.score < 70).length,
    },
  }
}
