import { findById as findPost, updatePost, PostStatus, ScheduleStatus } from '../models/Post.js'
import { findById as findAccount, updateAccount } from '../models/Account.js'
import { getSocialProvider } from '../providers/index.js'
import { getDb } from '../db/mongodb.js'
import { getRedis } from '../db/redis.js'
import { getRateLimitExpiration, storeRateLimitExceeded, parseRetryAfter } from '../utils/rateLimiter.js'

/**
 * Publish a post to all selected accounts in parallel.
 * Mirrors Laravel's Bus::batch()->allowFailures() — each account is independent;
 * one account failing does not prevent others from publishing.
 */
export async function publishPostJob({ post_id }) {
  const post = await findPost(post_id)
  if (!post) throw new Error(`Post ${post_id} not found`)

  // Run all accounts in parallel (mirrors Bus::batch with allowFailures)
  const results = await Promise.allSettled(
    post.account_ids.map(accountId => publishToAccount(post, accountId))
  )

  const published = []
  const errors = []

  for (const result of results) {
    if (result.status === 'fulfilled') {
      published.push(result.value)
    } else {
      errors.push(result.reason)
    }
  }

  const allFailed = published.length === 0 && errors.length > 0
  await updatePost(post_id, {
    status: allFailed ? PostStatus.FAILED : PostStatus.PUBLISHED,
    schedule_status: ScheduleStatus.PROCESSED,
    published_at: new Date(),
  })

  getRedis().publish('agentmarket:post_published', JSON.stringify({ post_id, published, errors }))
}

async function publishToAccount(post, accountId) {
  const post_id = post._id.toString()
  const account = await findAccount(accountId)

  if (!account) throw { account_id: accountId, error: 'Account not found' }
  if (!account.authorized) throw { account_id: accountId, error: 'Account not authorized' }

  // Check rate limit (app-level + account-level) — mirrors HasSocialProviderJobRateLimit
  const rateLimitTtl = await getRateLimitExpiration(account.provider, accountId)
  if (rateLimitTtl) throw { account_id: accountId, error: `Rate limited — retry in ${rateLimitTtl}s` }

  // Resolve version: account-specific first, fall back to original
  const version =
    post.versions.find(v => v.account_id === accountId) ||
    post.versions.find(v => v.is_original)

  if (!version) throw { account_id: accountId, error: 'No content version found' }

  try {
    const provider = await getSocialProvider(account.provider, {}, account)
    const result = await provider.publishPost(version)

    // Post first comment if the provider supports it and the version has one
    if (version.first_comment && result.provider_post_id && typeof provider.postComment === 'function') {
      try {
        await provider.postComment(result.provider_post_id, version.first_comment)
      } catch (commentErr) {
        // First comment failure is non-fatal — log but continue
        console.warn(`[PublishPost] First comment failed for account=${accountId}: ${commentErr.message}`)
      }
    }

    await getDb().collection('post_accounts').updateOne(
      { post_id, account_id: accountId },
      { $set: { post_id, account_id: accountId, provider_post_id: result.provider_post_id, data: result, errors: [] } },
      { upsert: true }
    )

    return accountId
  } catch (err) {
    const status = err.response?.status || err.code
    const headers = err.response?.headers || {}

    if (status === 429) {
      const retryAfter = parseRetryAfter(headers)
      const isAppLevel = !!headers['x-app-limit-24hour-reset']
      await storeRateLimitExceeded(account.provider, accountId, retryAfter, isAppLevel)
    }

    // Only mark unauthorized for real token/auth failures — not content errors
    // TikTok (and some others) return 401 from content APIs even with valid tokens
    const isAuthEndpoint = !err.config?.url?.includes('/publish') && !err.config?.url?.includes('/post')
    if ((status === 401 || status === 403) && isAuthEndpoint) {
      await updateAccount(accountId, { authorized: false })
      getRedis().publish('agentmarket:account_unauthorized', JSON.stringify({ account_id: accountId }))
    }

    // Extract the most useful error message: prefer the API response body over the generic Axios message
    const apiError = err.response?.data?.error?.message
      || err.response?.data?.message
      || err.response?.data
    const errorMsg = apiError
      ? (typeof apiError === 'string' ? apiError : JSON.stringify(apiError))
      : (err.message || err.error || 'Unknown error')

    console.error(`[PublishPost] account=${accountId} status=${status} error=${errorMsg}`)

    await getDb().collection('post_accounts').updateOne(
      { post_id, account_id: accountId },
      { $set: { post_id, account_id: accountId, provider_post_id: null, data: {}, errors: [errorMsg] } },
      { upsert: true }
    )

    throw { account_id: accountId, error: errorMsg }
  }
}
