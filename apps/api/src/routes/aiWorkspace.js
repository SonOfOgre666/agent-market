import { authenticate, requireWorkspaceAdmin } from '../middleware/auth.js'
import * as Integration from '../models/Integration.js'
import * as AiWorkspaceConfig from '../models/AiWorkspaceConfig.js'
import { getCatalog, catalogViews, validateFeatureAssignment, validatePlannerAssignment } from '../models/AiCatalog.js'
import { testProviderConnection, refreshOllamaModels } from '../lib/aiProviderTest.js'
import { buildAiWorkspaceOverview, assertFeatureProvidersConfigured } from '../lib/aiWorkspaceOverview.js'
import * as AiExecution from '../models/AiExecution.js'

export default async function aiWorkspaceRoutes(app) {
  app.get('/ai/workspace', { preHandler: [authenticate, requireWorkspaceAdmin] }, async (request, reply) => {
    const overview = await buildAiWorkspaceOverview(request.workspace_id)
    overview.warnings = await assertFeatureProvidersConfigured(
      request.workspace_id,
      overview.features,
    )
    const plannerKey = await Integration.hasApiKey(overview.planner.provider, request.workspace_id)
    const plannerRow = await Integration.findByName(overview.planner.provider, request.workspace_id)
    const { providerStatusFromKey } = await import('../lib/aiProviderTest.js')
    const plannerStatus = providerStatusFromKey(plannerKey, plannerRow?.test_status)
    if (!plannerKey || plannerStatus !== 'connected') {
      overview.warnings.push({
        feature_id: 'planner',
        provider: overview.planner.provider,
        message: 'Marketing Assistant agent provider is not connected',
      })
    }
    return reply.send(overview)
  })

  app.get('/ai/executions', { preHandler: [authenticate, requireWorkspaceAdmin] }, async (request, reply) => {
    const q = request.query || {}
    const page = Number(q.page) || 1
    const per_page = Number(q.per_page) || 50
    const data = await AiExecution.listByWorkspace(request.workspace_id, {
      page,
      per_page,
      feature_id: q.feature_id || undefined,
      provider: q.provider || undefined,
    })
    return reply.send(data)
  })

  app.get('/ai/catalog', { preHandler: [authenticate] }, async (_request, reply) => {
    const catalog = await getCatalog()
    return reply.send({ catalog, views: catalogViews(catalog) })
  })

  app.put('/ai/providers/:name', { preHandler: [authenticate, requireWorkspaceAdmin] }, async (request, reply) => {
    const { name } = request.params
    const catalog = await getCatalog()
    const providerIds = catalogViews(catalog).provider_ids
    if (!providerIds.includes(name)) {
      return reply.code(422).send({ error: `Unknown AI provider: ${name}` })
    }
    const wid = request.workspace_id
    const started = Date.now()

    if (name === 'ollama') {
      const baseUrl = (request.body?.base_url || '').trim()
      if (!baseUrl) return reply.code(422).send({ error: 'base_url is required' })
      const existing = await Integration.getDecryptedConfig(name, wid)
      const cfg = { ...existing, base_url: baseUrl }
      if ((request.body?.api_key || '').trim()) {
        cfg.api_key = (request.body.api_key || '').trim()
      }
      await Integration.upsertIntegration(name, cfg, wid)
      const status = await testProviderConnection(name, wid, { base_url: baseUrl })
      if (status === 'connected') {
        await refreshOllamaModels(wid, baseUrl)
      }
      await Integration.setTestStatus(name, wid, status)
      try {
        await AiExecution.insertExecution({
          workspace_id: wid,
          feature_id: 'key_test',
          provider: name,
          execution_type: 'test',
          duration_ms: Date.now() - started,
          status: status === 'connected' ? 'success' : 'failed',
          error: status === 'connected' ? null : 'Ollama server unreachable or no models found',
          source: 'settings_save',
        })
      } catch {
        // logging must not block provider save
      }
      return reply.send(await buildAiWorkspaceOverview(wid))
    }

    const apiKey = (request.body?.api_key || '').trim()
    if (!apiKey) return reply.code(422).send({ error: 'api_key is required' })
    await Integration.upsertIntegration(name, { api_key: apiKey }, wid)
    const status = await testProviderConnection(name, wid)
    await Integration.setTestStatus(name, wid, status)
    try {
      await AiExecution.insertExecution({
        workspace_id: wid,
        feature_id: 'key_test',
        provider: name,
        execution_type: 'test',
        duration_ms: Date.now() - started,
        status: status === 'connected' ? 'success' : 'failed',
        error: status === 'connected' ? null : 'API key validation failed on save',
        source: 'settings_save',
      })
    } catch {
      // logging must not block provider save
    }
    return reply.send(await buildAiWorkspaceOverview(wid))
  })

  app.post('/ai/providers/:name/test', { preHandler: [authenticate, requireWorkspaceAdmin] }, async (request, reply) => {
    const { name } = request.params
    const catalog = await getCatalog()
    const providerIds = catalogViews(catalog).provider_ids
    if (!providerIds.includes(name)) {
      return reply.code(422).send({ error: `Unknown AI provider: ${name}` })
    }
    const wid = request.workspace_id
    const hasKey = await Integration.hasApiKey(name, wid)
    const ollamaProbeUrl = name === 'ollama' ? (request.body?.base_url || '').trim() : ''
    if (!hasKey && !(name === 'ollama' && ollamaProbeUrl)) {
      await Integration.setTestStatus(name, wid, 'not_configured')
      return reply.send({ provider: name, status: 'not_configured' })
    }
    const started = Date.now()
    const status = await testProviderConnection(name, wid, { base_url: ollamaProbeUrl || undefined })
    if (name === 'ollama' && status === 'connected' && hasKey) {
      const cfg = await Integration.getDecryptedConfig(name, wid)
      const savedUrl = (cfg.base_url || '').trim()
      if (savedUrl && (!ollamaProbeUrl || ollamaProbeUrl === savedUrl)) {
        await refreshOllamaModels(wid, savedUrl)
      }
    }
    if (hasKey) {
      await Integration.setTestStatus(name, wid, status)
    }
    try {
      await AiExecution.insertExecution({
        workspace_id: wid,
        feature_id: 'key_test',
        provider: name,
        execution_type: 'test',
        duration_ms: Date.now() - started,
        status: status === 'connected' ? 'success' : 'failed',
        error: status === 'connected' ? null : 'API key test failed',
        source: 'settings',
      })
    } catch {
      // logging must not block provider test
    }
    const overview = await buildAiWorkspaceOverview(wid)
    return reply.send({ provider: name, status, overview })
  })

  app.put('/ai/features', { preHandler: [authenticate, requireWorkspaceAdmin] }, async (request, reply) => {
    const body = request.body?.features || request.body || {}
    const wid = request.workspace_id
    const catalog = await getCatalog()
    const featureIds = catalogViews(catalog).feature_ids
    for (const id of featureIds) {
      const row = body[id]
      if (!row) continue
      const err = await validateFeatureAssignment(id, row.provider, row.model, wid)
      if (err) return reply.code(422).send({ error: err })
      const { isProviderUsable } = await import('../lib/aiFeatureRuntime.js')
      if (!(await isProviderUsable(row.provider, wid))) {
        return reply.code(422).send({
          error: `${row.provider} is not connected — save and test the API key first`,
        })
      }
    }
    const config = await AiWorkspaceConfig.upsertFeatures(wid, body)
    const overview = await buildAiWorkspaceOverview(wid)
    overview.features = config.features
    overview.warnings = await assertFeatureProvidersConfigured(wid, config.features)
    return reply.send(overview)
  })

  app.put('/ai/planner', { preHandler: [authenticate, requireWorkspaceAdmin] }, async (request, reply) => {
    const body = request.body?.planner || request.body || {}
    const wid = request.workspace_id
    const err = await validatePlannerAssignment(
      body.provider,
      body.model,
      body.max_workflow_steps,
      wid,
    )
    if (err) return reply.code(422).send({ error: err })
    const { isProviderUsable } = await import('../lib/aiFeatureRuntime.js')
    if (!(await isProviderUsable(body.provider, wid))) {
      return reply.code(422).send({ error: 'Planner provider is not connected — test the API key first' })
    }
    const config = await AiWorkspaceConfig.upsertPlanner(wid, body)
    const overview = await buildAiWorkspaceOverview(wid)
    overview.planner = config.planner
    overview.warnings = await assertFeatureProvidersConfigured(wid, overview.features)
    return reply.send(overview)
  })
}
