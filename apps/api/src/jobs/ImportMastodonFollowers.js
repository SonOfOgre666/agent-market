import { findById as findAccount, updateAccount } from '../models/Account.js'
import { upsertAudience } from '../models/Metric.js'
import { getRedis } from '../db/redis.js'
import { parseRetryAfter } from '../utils/rateLimiter.js'
import axios from 'axios'

export async function importMastodonFollowersJob({ account_id }) {
  const account = await findAccount(account_id)
  if (!account || !account.authorized) return

  const rateLimitKey = `agentmarket:ratelimit:mastodon:${account_id}`
  const limited = await getRedis().get(rateLimitKey)
  if (limited) return

  const token = account.access_token?.token
  const serverUrl = account.data?.server_url
  if (!token || !serverUrl) return

  try {
    const res = await axios.get(`${serverUrl}/api/v1/accounts/verify_credentials`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const followersCount = res.data.followers_count ?? 0
    const today = new Date().toISOString().split('T')[0]
    await upsertAudience(account_id, today, followersCount)
    console.log(`[ImportMastodonFollowers] account=${account_id} followers=${followersCount}`)
  } catch (err) {
    if (err.response?.status === 429) {
      // x-ratelimit-reset is an ISO datetime string on Mastodon instances
      const retryAfter = parseRetryAfter(err.response.headers)
      await getRedis().setex(rateLimitKey, retryAfter, '1')
    }
    if (err.response?.status === 401) {
      await updateAccount(account_id, { authorized: false })
      getRedis().publish('agentmarket:account_unauthorized', JSON.stringify({ account_id }))
    }
    throw err
  }
}
