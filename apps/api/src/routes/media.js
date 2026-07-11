import { authenticate } from '../middleware/auth.js'
import * as Media from '../models/Media.js'
import { processMedia } from '../media/processor.js'
import { fetchFromUnsplash, fetchFromGiphy } from '../services/external.js'
import { downloadExternalMedia } from '../media/downloader.js'
import path from 'path'
import fs from 'fs/promises'
import { nanoid } from 'nanoid'

const UPLOAD_DIR = process.env.STORAGE_LOCAL_PATH || './uploads'

export default async function mediaRoutes(app) {
  // GET /api/media
  app.get('/media', { preHandler: [authenticate] }, async (request, reply) => {
    const { page = 1, per_page = 24 } = request.query
    const result = await Media.findAll({ workspace_id: request.workspace_id, page: parseInt(page), per_page: parseInt(per_page) })
    return reply.send({ ...result, items: result.items.map(Media.serialize) })
  })

  // DELETE /api/media  (batch delete by IDs)
  app.delete('/media', { preHandler: [authenticate] }, async (request, reply) => {
    const { ids = [] } = request.body || {}
    if (!ids.length) return reply.code(422).send({ error: 'No media IDs provided' })
    await Media.deleteMediaItems(ids)
    return reply.code(204).send()
  })

  // GET /api/media/fetch/uploaded  — paginated list for picker
  app.get('/media/fetch/uploaded', { preHandler: [authenticate] }, async (request, reply) => {
    const { page = 1 } = request.query
    const result = await Media.findAll({ workspace_id: request.workspace_id, page: parseInt(page), per_page: 30 })
    return reply.send({ ...result, items: result.items.map(Media.serialize) })
  })

  // GET /api/media/fetch/stock  — Unsplash
  app.get('/media/fetch/stock', { preHandler: [authenticate] }, async (request, reply) => {
    const { query = '', page = 1 } = request.query
    try {
      const results = await fetchFromUnsplash(query, parseInt(page))
      return reply.send(results)
    } catch (err) {
      return reply.code(400).send({ error: err.message })
    }
  })

  // GET /api/media/fetch/gifs  — Giphy
  app.get('/media/fetch/gifs', { preHandler: [authenticate] }, async (request, reply) => {
    const { query = '', page = 1 } = request.query
    try {
      const results = await fetchFromGiphy(query, parseInt(page))
      return reply.send(results)
    } catch (err) {
      return reply.code(400).send({ error: err.message })
    }
  })

  // POST /api/media/download  — download external URL to library
  app.post('/media/download', { preHandler: [authenticate] }, async (request, reply) => {
    const { url, source, download_location } = request.body || {}
    if (!url) return reply.code(422).send({ error: 'URL is required' })
    try {
      const media = await downloadExternalMedia(url, source, download_location, request.workspace_id)
      return reply.code(201).send(Media.serialize(media))
    } catch (err) {
      return reply.code(400).send({ error: err.message })
    }
  })

  // POST /api/media/upload  — direct file upload
  app.post('/media/upload', { preHandler: [authenticate] }, async (request, reply) => {
    const data = await request.file()
    if (!data) return reply.code(422).send({ error: 'No file provided' })

    if (!Media.ALLOWED_MIME.includes(data.mimetype)) {
      return reply.code(422).send({ error: `Unsupported file type: ${data.mimetype}` })
    }

    await fs.mkdir(UPLOAD_DIR, { recursive: true })
    const ext = path.extname(data.filename)
    const filename = `${nanoid()}${ext}`
    const dest = path.join(UPLOAD_DIR, filename)
    const buffer = await data.toBuffer()

    if (data.mimetype.startsWith('video') && buffer.length > Media.MAX_SIZE.video) {
      return reply.code(422).send({ error: 'Video exceeds 200 MB limit' })
    }
    if (data.mimetype === 'image/gif' && buffer.length > Media.MAX_SIZE.gif) {
      return reply.code(422).send({ error: 'GIF exceeds 15 MB limit' })
    }
    if (data.mimetype.startsWith('image') && buffer.length > Media.MAX_SIZE.image) {
      return reply.code(422).send({ error: 'Image exceeds 20 MB limit' })
    }

    await fs.writeFile(dest, buffer)

    const media = await Media.createMedia({
      workspace_id: request.workspace_id,
      name: data.filename,
      mime_type: data.mimetype,
      disk: 'local',
      path: filename,
      size: buffer.length,
    })

    processMedia(media).catch(console.error)

    return reply.code(201).send(Media.serialize(media))
  })
}
