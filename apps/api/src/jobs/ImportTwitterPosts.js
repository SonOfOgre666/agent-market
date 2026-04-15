import { findById as findAccount, updateAccount } from '../models/Account.js'
import { upsert as upsertImportedPost } from '../models/ImportedPost.js'
import { getRedis } from '../db/redis.js'
import { TwitterApi } from 'twitter-api-v2'
import * as Service from '../models/Service.js'

export async function importTwitterPostsJob({ account_id, pagination_token = '' }) {
  const account = await findAccount(account_id)
  if (!account || !account.authorized) return

  const rateLimitKey = `agentmarket:ratelimit:twitter:${account_id}`
  const limited = await getRedis().get(rateLimitKey)
  if (limited) return

  const config = await Service.getDecryptedConfig('twitter')
  const tier = config.tier || 'free'

  // Free tier does not support timeline endpoint
  if (tier === 'free') return

  const { token, secret } = account.access_token || {}
  if (!token) return

  const client = new TwitterApi({
    appKey: config.client_id,
    appSecret: config.client_secret,
    accessToken: token,
    accessSecret: secret,
  })

  try {
    const sinceDate = new Date()
    sinceDate.setMonth(sinceDate.getMonth() - 3)

    const params = {
      'tweet.fields': 'public_metrics,created_at,in_reply_to_user_id',
      start_time: sinceDate.toISOString(),
      exclude: 'retweets,replies',
      max_results: 100,
    }
    if (pagination_token) params.pagination_token = pagination_token

    const timeline = await client.v2.userTimeline(account.provider_id, params)

    for (const tweet of timeline.data?.data || []) {
      await upsertImportedPost(
        account_id,
        tweet.id,
        { text: tweet.text, created_at: tweet.created_at },
        {
          likes: tweet.public_metrics?.like_count ?? 0,
          replies: tweet.public_metrics?.reply_count ?? 0,
          retweets: tweet.public_metrics?.retweet_count ?? 0,
          impressions: tweet.public_metrics?.impression_count ?? 0,
        }
      )
    }

    // Paginate if more results
    const nextToken = timeline.data?.meta?.next_token
    if (nextToken) {
      const { dispatchImportTwitterPosts } = await import('../queue/dispatcher.js')
      await dispatchImportTwitterPosts(account_id, nextToken)
    }
  } catch (err) {
    if (err.code === 429) await getRedis().setex(rateLimitKey, 900, '1')
    if (err.code === 401) {
      await updateAccount(account_id, { authorized: false })
      getRedis().publish('agentmarket:account_unauthorized', JSON.stringify({ account_id }))
    }
    throw err
  }
}
