import { authenticate } from '../middleware/auth.js'
import * as Service from '../models/Service.js'
import { createMastodonApp } from '../providers/mastodon.js'

export default async function serviceRoutes(app) {
  // GET /api/services
  app.get('/services', { preHandler: [authenticate] }, async (request, reply) => {
    const services = await Service.findAll(request.workspace_id)
    // Return with decrypted config for owner
    return reply.send(services.map(s => Service.serialize(s, true)))
  })

  // PUT /api/services/:name
  app.put('/services/:name', { preHandler: [authenticate] }, async (request, reply) => {
    const { name } = request.params
    if (!Service.SERVICE_NAMES.includes(name)) {
      return reply.code(422).send({ error: `Unknown service: ${name}` })
    }
    const config = request.body || {}
    const service = await Service.upsertService(name, config, request.workspace_id)
    return reply.send(Service.serialize(service, true))
  })

  // POST /api/services/mastodon/create-app
  app.post('/services/mastodon/create-app', { preHandler: [authenticate] }, async (request, reply) => {
    const { server_url } = request.body || {}
    if (!server_url) return reply.code(422).send({ error: 'server_url is required' })
    try {
      const appData = await createMastodonApp(server_url)
      return reply.send(appData)
    } catch (err) {
      return reply.code(400).send({ error: err.message })
    }
  })
}
