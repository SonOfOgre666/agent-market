import { authenticate } from '../middleware/auth.js'
import * as Account from '../models/Account.js'
import { getWorkspaceDashboard } from '../services/dashboardOverview.js'

export default async function dashboardRoutes(app) {
  // GET /api/dashboard — workspace JWT (canonical)
  app.get('/dashboard', { preHandler: [authenticate] }, async (request, reply) => {
    const wid = request.workspace_id
    const [accounts, overview] = await Promise.all([
      Account.findAll(wid),
      getWorkspaceDashboard(wid),
    ])
    return reply.send({
      accounts: accounts.map(Account.serialize),
      ...overview,
    })
  })
}
