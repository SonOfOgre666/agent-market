import { findById as findAccount, updateAccount } from '../models/Account.js'
import { upsertAudience } from '../models/Metric.js'
import { getRedis } from '../db/redis.js'
import axios from 'axios'

const GRAPH = 'https://graph.facebook.com/v25.0'

export async function importFacebookFollowersJob({ account_id }) {
  const account = await findAccount(account_id)
  if (!account || !account.authorized || account.provider !== 'facebook') return

  const rateLimitKey = `agentmarket:ratelimit:facebook:${account_id}`
  const limited = await getRedis().get(rateLimitKey)
  if (limited) return

  const token = account.access_token?.token
  if (!token) return

  try {
    // Mirrors getPageAudience(): fields=fan_count,followers_count
    const res = await axios.get(`${GRAPH}/${account.provider_id}`, {
      params: { fields: 'fan_count,followers_count', access_token: token },
    })
    const total = res.data.followers_count ?? res.data.fan_count ?? 0
    const today = new Date().toISOString().split('T')[0]
    await upsertAudience(account_id, today, total)
    console.log(`[ImportFacebookFollowers] account=${account_id} followers=${total}`)
  } catch (err) {
    if (err.response?.status === 429) await getRedis().setex(rateLimitKey, 3600, '1')
    if (err.response?.status === 401 || err.response?.data?.error?.code === 190) {
      await updateAccount(account_id, { authorized: false })
      getRedis().publish('agentmarket:account_unauthorized', JSON.stringify({ account_id }))
    }
    throw err
  }
}
