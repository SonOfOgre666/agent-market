import { authenticate } from '../middleware/auth.js'
import { auditWorkspaceLandingPages } from '../services/seoLandingAudit.js'
import {
  listKeywordTargets,
  addKeywordTarget,
  deleteKeywordTarget,
  checkWorkspaceKeywordRanks,
  recentRankSnapshots,
} from '../services/seoKeywordTracking.js'
import {
  clusterSeoKeywords,
  listRecentKeywordClusters,
} from '../services/seoKeywordClusters.js'

export default async function seoRoutes(app) {
  // GET /api/seo/landing-pages/audit — ONBOARDING §9.3 lightweight technical audit
  app.get('/seo/landing-pages/audit', { preHandler: [authenticate] }, async (request, reply) => {
    const out = await auditWorkspaceLandingPages(request.workspace_id)
    return reply.send(out)
  })

  // GET /api/seo/keywords/targets
  app.get('/seo/keywords/targets', { preHandler: [authenticate] }, async (request, reply) => {
    const items = await listKeywordTargets(request.workspace_id)
    return reply.send({ items })
  })

  // POST /api/seo/keywords/targets
  app.post('/seo/keywords/targets', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const out = await addKeywordTarget(request.workspace_id, request.body || {})
      return reply.code(201).send(out)
    } catch (err) {
      return reply.code(err.statusCode || 422).send({ error: err.message })
    }
  })

  // DELETE /api/seo/keywords/targets/:id
  app.delete('/seo/keywords/targets/:id', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      await deleteKeywordTarget(request.workspace_id, request.params.id)
      return reply.code(204).send()
    } catch (err) {
      return reply.code(err.statusCode || 404).send({ error: err.message })
    }
  })

  // POST /api/seo/keywords/check-ranks
  app.post('/seo/keywords/check-ranks', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const out = await checkWorkspaceKeywordRanks(request.workspace_id, request.body || {})
      return reply.send(out)
    } catch (err) {
      return reply.code(err.statusCode || 422).send({ error: err.message })
    }
  })

  // GET /api/seo/keywords/rank-history
  app.get('/seo/keywords/rank-history', { preHandler: [authenticate] }, async (request, reply) => {
    const limit = Math.min(200, Number(request.query?.limit) || 50)
    const items = await recentRankSnapshots(request.workspace_id, { limit })
    return reply.send({ items })
  })

  // POST /api/seo/keywords/cluster
  app.post('/seo/keywords/cluster', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const out = await clusterSeoKeywords(request.workspace_id, request.body || {})
      return reply.send(out)
    } catch (err) {
      return reply.code(err.statusCode || 422).send({ error: err.message })
    }
  })

  // GET /api/seo/keywords/clusters/recent
  app.get('/seo/keywords/clusters/recent', { preHandler: [authenticate] }, async (request, reply) => {
    const items = await listRecentKeywordClusters(request.workspace_id, {
      limit: Number(request.query?.limit) || 5,
    })
    return reply.send({ items })
  })

}
