/**
 * Rate limiter utility — mirrors HasSocialProviderJobRateLimit trait from Laravel.
 * Supports app-level and account-level rate limit tracking via Redis.
 */
import { getRedis } from '../lib/redis.js'

/**
 * @param {string} provider  e.g. 'twitter', 'facebook', 'mastodon'
 * @param {string} accountId MongoDB _id string
 * @param {boolean} appLevel  true = app-wide limit (shared across all accounts)
 */
function buildKey(provider, accountId, appLevel = false) {
  return appLevel
    ? `agentmarket:ratelimit:${provider}:app`
    : `agentmarket:ratelimit:${provider}:${accountId}`
}

/**
 * Returns the seconds remaining on a rate limit, or null if not limited.
 */
export async function getRateLimitExpiration(provider, accountId) {
  const redis = getRedis()
  const [accountTtl, appTtl] = await Promise.all([
    redis.ttl(buildKey(provider, accountId, false)),
    redis.ttl(buildKey(provider, accountId, true)),
  ])
  const ttl = Math.max(accountTtl, appTtl)
  return ttl > 0 ? ttl : null
}

/**
 * Store a rate limit hit.
 * @param {string} provider
 * @param {string} accountId
 * @param {number} retryAfterSeconds  seconds until the limit resets
 * @param {boolean} appLevel
 */
export async function storeRateLimitExceeded(provider, accountId, retryAfterSeconds, appLevel = false) {
  const key = buildKey(provider, accountId, appLevel)
  await getRedis().setex(key, Math.max(retryAfterSeconds, 60), '1')
}

/**
 * Clear rate limit for an account (call on successful response).
 */
export async function clearRateLimit(provider, accountId) {
  const redis = getRedis()
  await Promise.all([
    redis.del(buildKey(provider, accountId, false)),
    redis.del(buildKey(provider, accountId, true)),
  ])
}

/**
 * Parse Retry-After from HTTP response headers (supports seconds, HTTP-date, and Unix timestamps).
 * Handles:
 *   - retry-after: seconds (standard)
 *   - x-rate-limit-reset / x-ratelimit-reset: seconds or ISO datetime (Twitter, Mastodon)
 *   - x-app-limit-24hour-reset: Unix timestamp in seconds (Meta Graph API)
 */
export function parseRetryAfter(headers = {}) {
  // Meta Graph API: x-app-limit-24hour-reset is a Unix timestamp (seconds since epoch)
  const metaReset = headers['x-app-limit-24hour-reset']
  if (metaReset) {
    const ts = parseInt(metaReset)
    if (!isNaN(ts)) return Math.max(60, Math.ceil(ts - Date.now() / 1000))
  }

  const header = headers['retry-after'] || headers['x-rate-limit-reset'] || headers['x-ratelimit-reset']
  if (!header) return 900 // default 15 min
  const asInt = parseInt(header)
  if (!isNaN(asInt) && asInt < 1e10) return asInt // seconds format
  // HTTP-date or ISO datetime format (e.g. Mastodon's x-ratelimit-reset)
  const date = new Date(header)
  if (!isNaN(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000))
  return 900
}
