import { authenticate } from '../middleware/auth.js'
import { getDb } from '../db/mongodb.js'
import * as Account from '../models/Account.js'

export default async function reportRoutes(app) {
  // GET /api/reports?account_id=...&from=2024-01-01&to=2024-01-31
  app.get('/reports', { preHandler: [authenticate] }, async (request, reply) => {
    const { account_id, from, to } = request.query
    if (!account_id) return reply.code(422).send({ error: 'account_id is required' })

    const account = await Account.findByUuid(account_id) || await Account.findById(account_id)
    if (!account) return reply.code(404).send({ error: 'Account not found' })

    if (account.workspace_id && account.workspace_id !== request.workspace_id) {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    const aid = account._id.toString()
    const db = getDb()

    // Current period filter
    const dateFilter = {}
    if (from) dateFilter.$gte = from
    if (to)   dateFilter.$lte = to

    const metricMatch = { account_id: aid, ...(Object.keys(dateFilter).length ? { date: dateFilter } : {}) }

    // Previous period: same duration shifted back
    let prevMetricMatch = null
    if (from && to) {
      const fromDate = new Date(from)
      const toDate = new Date(to)
      const durationMs = toDate - fromDate
      const prevTo = new Date(fromDate - 1)  // day before current period
      const prevFrom = new Date(prevTo - durationMs)
      const prevFromStr = prevFrom.toISOString().split('T')[0]
      const prevToStr = prevTo.toISOString().split('T')[0]
      prevMetricMatch = { account_id: aid, date: { $gte: prevFromStr, $lte: prevToStr } }
    }

    const [metrics, audience, fbInsights, prevMetrics, prevAudience] = await Promise.all([
      db.collection('metrics').find(metricMatch).sort({ date: 1 }).toArray(),
      db.collection('audience').find(metricMatch).sort({ date: 1 }).toArray(),
      account.provider === 'facebook'
        ? db.collection('facebook_insights').find(metricMatch).sort({ date: 1 }).toArray()
        : Promise.resolve([]),
      prevMetricMatch
        ? db.collection('metrics').find(prevMetricMatch).sort({ date: 1 }).toArray()
        : Promise.resolve([]),
      prevMetricMatch
        ? db.collection('audience').find(prevMetricMatch).sort({ date: 1 }).toArray()
        : Promise.resolve([]),
    ])

    const sumMetrics = (rows) => rows.reduce((acc, m) => {
      for (const [k, v] of Object.entries(m.data || {})) {
        acc[k] = (acc[k] || 0) + (Number(v) || 0)
      }
      return acc
    }, {})

    const totals = sumMetrics(metrics)
    const previous_totals = prevMetrics.length ? sumMetrics(prevMetrics) : null

    const latestAudience = audience.length ? audience[audience.length - 1].total : null
    const prevLatestAudience = prevAudience.length ? prevAudience[prevAudience.length - 1].total : null

    return reply.send({
      account: Account.serialize(account),
      metrics,
      audience,
      facebook_insights: fbInsights,
      totals,
      previous_totals,
      latest_followers: latestAudience,
      previous_followers: prevLatestAudience,
    })
  })
}
