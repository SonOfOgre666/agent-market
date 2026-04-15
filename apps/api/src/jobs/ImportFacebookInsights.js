import { findById as findAccount, updateAccount } from '../models/Account.js'
import { upsertFacebookInsight } from '../models/Metric.js'
import { getRedis } from '../db/redis.js'
import axios from 'axios'

const GRAPH = 'https://graph.facebook.com/v25.0'

// Facebook insight type constants (mirrors FacebookInsightType enum)
export const FacebookInsightType = {
  PAGE_POST_ENGAGEMENTS:  1,
  PAGE_POSTS_IMPRESSIONS: 2,
}

const METRIC_NAME_TO_TYPE = {
  page_post_engagements:  FacebookInsightType.PAGE_POST_ENGAGEMENTS,
  page_posts_impressions: FacebookInsightType.PAGE_POSTS_IMPRESSIONS,
}

export async function importFacebookInsightsJob({ account_id }) {
  const account = await findAccount(account_id)
  if (!account || !account.authorized || account.provider !== 'facebook') return

  const rateLimitKey = `agentmarket:ratelimit:facebook:${account_id}`
  const limited = await getRedis().get(rateLimitKey)
  if (limited) return

  const token = account.access_token?.token
  if (!token) return

  try {
    const since = new Date()
    since.setDate(since.getDate() - 90)

    // Mirrors getPageInsights(): metric=page_post_engagements,page_posts_impressions, period=day
    const res = await axios.get(`${GRAPH}/${account.provider_id}/insights`, {
      params: {
        access_token: token,
        metric: 'page_post_engagements,page_posts_impressions',
        period: 'day',
        since: since.toISOString().split('T')[0],
        until: new Date().toISOString().split('T')[0],
      },
    })

    const insights = res.data?.data || []

    for (const insight of insights) {
      const type = METRIC_NAME_TO_TYPE[insight.name]
      if (!type) continue

      for (const item of insight.values || []) {
        // end_time format: "2024-01-15T08:00:00+0000"
        const date = item.end_time?.split('T')[0] || new Date().toISOString().split('T')[0]
        await upsertFacebookInsight(account_id, type, item.value ?? 0, date)
      }
    }

    console.log(`[ImportFacebookInsights] account=${account_id} insight_types=${insights.length}`)
  } catch (err) {
    if (err.response?.status === 429) await getRedis().setex(rateLimitKey, 3600, '1')
    if (err.response?.status === 401 || err.response?.data?.error?.code === 190) {
      await updateAccount(account_id, { authorized: false })
      getRedis().publish('agentmarket:account_unauthorized', JSON.stringify({ account_id }))
    }
    throw err
  }
}
