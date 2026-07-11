import { authenticate } from '../middleware/auth.js'
import { getDb } from '../lib/mongo.js'
import * as Account from '../models/Account.js'

const FACEBOOK_INSIGHT_KEYS = {
  1: 'page_post_engagements',
  2: 'page_posts_impressions',
}

function pivotFacebookInsights(rows) {
  const byDate = {}
  for (const row of rows) {
    const date = row.date
    if (!date) continue
    const key = FACEBOOK_INSIGHT_KEYS[row.type] || `metric_${row.type}`
    if (!byDate[date]) byDate[date] = { date }
    byDate[date][key] = Number(row.value) || 0
  }
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date))
}

const FACEBOOK_INSIGHT_PROVIDERS = new Set(['facebook', 'facebook_page'])

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
      FACEBOOK_INSIGHT_PROVIDERS.has(account.provider)
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

    const facebook_insights_daily = pivotFacebookInsights(fbInsights)
    const previous_fb_daily = prevMetricMatch && FACEBOOK_INSIGHT_PROVIDERS.has(account.provider)
      ? pivotFacebookInsights(
          await db.collection('facebook_insights').find(prevMetricMatch).sort({ date: 1 }).toArray(),
        )
      : []

    const sumInsightDaily = (rows) => rows.reduce((acc, row) => {
      for (const [k, v] of Object.entries(row)) {
        if (k === 'date') continue
        acc[k] = (acc[k] || 0) + (Number(v) || 0)
      }
      return acc
    }, {})

    const fbTotals = facebook_insights_daily.length ? sumInsightDaily(facebook_insights_daily) : null
    const prevFbTotals = previous_fb_daily.length ? sumInsightDaily(previous_fb_daily) : null

    return reply.send({
      account: Account.serialize(account),
      metrics,
      audience,
      facebook_insights: fbInsights,
      facebook_insights_daily,
      totals: fbTotals || totals,
      previous_totals: prevFbTotals || previous_totals,
      latest_followers: latestAudience,
      previous_followers: prevLatestAudience,
    })
  })
}
