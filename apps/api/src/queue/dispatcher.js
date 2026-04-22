import { getRedis } from '../db/redis.js'

const QUEUE_KEY = 'agentmarket:queue'

export async function dispatch(queue, job, payload) {
  const message = JSON.stringify({ job, payload, attempts: 0, created_at: Date.now() })
  await getRedis().rpush(`${QUEUE_KEY}:${queue}`, message)
}

// Post publishing
export async function dispatchPublishPost(postId) {
  return dispatch('publish-post', 'PublishPost', { post_id: postId })
}

// Twitter
export async function dispatchImportTwitterFollowers(accountId) {
  return dispatch('imports', 'ImportTwitterFollowers', { account_id: accountId })
}
export async function dispatchImportTwitterPosts(accountId, paginationToken = '') {
  return dispatch('imports', 'ImportTwitterPosts', { account_id: accountId, pagination_token: paginationToken })
}
export async function dispatchProcessTwitterMetrics(accountId) {
  return dispatch('imports', 'ProcessTwitterMetrics', { account_id: accountId })
}

// Facebook
export async function dispatchImportFacebookFollowers(accountId) {
  return dispatch('imports', 'ImportFacebookFollowers', { account_id: accountId })
}
export async function dispatchImportFacebookInsights(accountId) {
  return dispatch('imports', 'ImportFacebookInsights', { account_id: accountId })
}

// Instagram
export async function dispatchImportInstagramFollowers(accountId) {
  return dispatch('imports', 'ImportInstagramFollowers', { account_id: accountId })
}
