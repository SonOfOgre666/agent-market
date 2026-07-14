import { authenticate, requireWorkspaceAdmin } from '../middleware/auth.js'
import * as Setting from '../models/Setting.js'

export default async function settingRoutes(app) {
  // GET /api/settings
  app.get('/settings', { preHandler: [authenticate] }, async (request, reply) => {
    const settings = await Setting.getAll(request.workspace_id)
    return reply.send(settings)
  })

  // PUT /api/settings
  app.put('/settings', { preHandler: [authenticate, requireWorkspaceAdmin] }, async (request, reply) => {
    const body = request.body || {}
    const allowed = [
      'timezone',
      'date_format',
      'time_format',
      'week_starts_on',
      'admin_email',
      'default_accounts',
      'auto_analyze_comments',
      'agent_auto_approve',
    ]
    const toSave = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)))

    // Validate — mirrors Settings.php rules()
    const errors = Setting.validate(toSave)
    if (errors) return reply.code(422).send({ errors })

    await Setting.setMany(toSave, request.workspace_id)
    return reply.send(await Setting.getAll(request.workspace_id))
  })
}
