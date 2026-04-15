import { authenticate } from '../middleware/auth.js'
import * as Tag from '../models/Tag.js'

export default async function tagRoutes(app) {
  // GET /api/tags
  app.get('/tags', { preHandler: [authenticate] }, async (request, reply) => {
    const tags = await Tag.findAll(request.workspace_id)
    return reply.send(tags.map(Tag.serialize))
  })

  // POST /api/tags
  app.post('/tags', { preHandler: [authenticate] }, async (request, reply) => {
    const { name, hex_color } = request.body || {}
    if (!name) return reply.code(422).send({ error: 'Tag name is required' })
    const tag = await Tag.createTag({ workspace_id: request.workspace_id, name, hex_color: hex_color || '#6366f1' })
    return reply.code(201).send(Tag.serialize(tag))
  })

  // PUT /api/tags/:id
  app.put('/tags/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const tag = await Tag.findById(request.params.id, request.workspace_id)
    if (!tag) return reply.code(404).send({ error: 'Tag not found' })
    const { name, hex_color } = request.body || {}
    const updated = await Tag.updateTag(tag._id.toString(), { name: name || tag.name, hex_color: hex_color || tag.hex_color })
    return reply.send(Tag.serialize(updated))
  })

  // DELETE /api/tags/:id
  app.delete('/tags/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const tag = await Tag.findById(request.params.id, request.workspace_id)
    if (!tag) return reply.code(404).send({ error: 'Tag not found' })
    await Tag.deleteTag(tag._id.toString())
    return reply.code(204).send()
  })
}
