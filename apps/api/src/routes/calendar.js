import { authenticate } from '../middleware/auth.js'
import * as Post from '../models/Post.js'
import * as Account from '../models/Account.js'
import * as Tag from '../models/Tag.js'

export default async function calendarRoutes(app) {
  // GET /api/calendar?date=2024-01&type=month
  app.get('/calendar', { preHandler: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const { date = new Date().toISOString().slice(0, 7), type = 'month' } = request.query
    const [posts, accounts, tags] = await Promise.all([
      Post.findForCalendar({ workspace_id: wid, date, type }),
      Account.findAll(wid),
      Tag.findAll(wid),
    ])
    return reply.send({
      posts: posts.map(Post.serialize),
      accounts: accounts.map(Account.serialize),
      tags: tags.map(Tag.serialize),
    })
  })
}
