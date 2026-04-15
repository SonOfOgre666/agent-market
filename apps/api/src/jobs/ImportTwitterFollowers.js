import { findById as findAccount, updateAccount } from '../models/Account.js'
import { upsertAudience } from '../models/Metric.js'
import { getRedis } from '../db/redis.js'
import { TwitterApi } from 'twitter-api-v2'
import * as Service from '../models/Service.js'

export async function importTwitterFollowersJob({ account_id }) {
  const account = await findAccount(account_id)
  if (!account || !account.authorized) return

  // Check rate limit lock
  const rateLimitKey = `agentmarket:ratelimit:twitter:${account_id}`
  const limited = await getRedis().get(rateLimitKey)
  if (limited) {
    console.log(`[ImportTwitterFollowers] Rate limited, skipping ${account_id}`)
    return
  }

  const config = await Service.getDecryptedConfig('twitter')
  const { token, secret } = account.access_token || {}
  if (!token) return

  const client = new TwitterApi({
    appKey: config.client_id,
    appSecret: config.client_secret,
    accessToken: token,
    accessSecret: secret,
  })

  try {
    const me = await client.v2.me({ 'user.fields': ['public_metrics'] })
    const followersCount = me.data.public_metrics?.followers_count ?? 0
    const today = new Date().toISOString().split('T')[0]
    await upsertAudience(account_id, today, followersCount)
    console.log(`[ImportTwitterFollowers] account=${account_id} followers=${followersCount}`)
  } catch (err) {
    if (err.code === 429) {
      // Rate limited — lock for 15 min
      await getRedis().setex(rateLimitKey, 900, '1')
    }
    if (err.code === 401) {
      await updateAccount(account_id, { authorized: false })
      getRedis().publish('agentmarket:account_unauthorized', JSON.stringify({ account_id }))
    }
    throw err
  }
}
