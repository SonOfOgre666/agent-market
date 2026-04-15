import { findById as findAccount, updateAccount } from '../models/Account.js'
import { upsert as upsertImportedPost } from '../models/ImportedPost.js'
import { getRedis } from '../db/redis.js'
import axios from 'axios'

export async function importMastodonPostsJob({ account_id, max_id = '' }) {
  const account = await findAccount(account_id)
  if (!account || !account.authorized) return

  const rateLimitKey = `agentmarket:ratelimit:mastodon:${account_id}`
  const limited = await getRedis().get(rateLimitKey)
  if (limited) return

  const token = account.access_token?.token
  const serverUrl = account.data?.server_url
  if (!token || !serverUrl) return

  try {
    const params = { exclude_replies: true, exclude_reblogs: true, limit: 40 }
    if (max_id) params.max_id = max_id

    const res = await axios.get(`${serverUrl}/api/v1/accounts/${account.provider_id}/statuses`, {
      headers: { Authorization: `Bearer ${token}` },
      params,
    })

    const statuses = res.data || []
    for (const status of statuses) {
      const createdAt = status.created_at?.split('T')[0] || new Date().toISOString().split('T')[0]
      await upsertImportedPost(
        account_id,
        status.id,
        { text: status.content, created_at: createdAt, url: status.url },
        {
          replies:    status.replies_count   ?? 0,
          reblogs:    status.reblogs_count   ?? 0,
          favourites: status.favourites_count ?? 0,
        }
      )
    }

    // Paginate via Link header or last status id
    if (statuses.length === 40) {
      const lastId = statuses[statuses.length - 1].id
      const { dispatch } = await import('../queue/dispatcher.js')
      await dispatch('imports', 'ImportMastodonPosts', { account_id, max_id: lastId })
    }
  } catch (err) {
    if (err.response?.status === 429) {
      const retryAfter = parseInt(err.response.headers['x-ratelimit-reset'] || '900')
      await getRedis().setex(rateLimitKey, retryAfter, '1')
    }
    if (err.response?.status === 401) {
      await updateAccount(account_id, { authorized: false })
      getRedis().publish('agentmarket:account_unauthorized', JSON.stringify({ account_id }))
    }
    throw err
  }
}
