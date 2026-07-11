import { authenticate } from '../middleware/auth.js'
import * as Post from '../models/Post.js'

export default async function calendarRoutes(app) {
  // GET /api/calendar?date=2024-01
  app.get('/calendar', { preHandler: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const { date = new Date().toISOString().slice(0, 7) } = request.query
    const posts = await Post.findForCalendar({ workspace_id: wid, date })
    return reply.send({
      posts: posts.map(Post.serialize),
    })
  })
}
