/**
 * Enqueue-only dispatcher: all background work goes to Celery via the API task bridge.
 * Node ``agentmarket:queue:*`` BLPOP workers are removed — see ``services/ai-worker``.
 */
import { enqueueCeleryTask } from '../lib/celeryEnqueue.js'

/** @returns {Promise<{ via: 'celery', task_id: string }>} */
export async function dispatchPublishPost(postId) {
  // Same task as registry tool publish_post (agent runtime).
  const task_id = await enqueueCeleryTask('tasks.social.publish_post', [postId])
  return { via: 'celery', task_id }
}

/** @returns {Promise<{ via: 'celery', task_id: string }>} */
export async function dispatchPublishCampaign(campaignId) {
  const task_id = await enqueueCeleryTask('tasks.ads.publish_campaign', [campaignId])
  return { via: 'celery', task_id }
}

/** @returns {Promise<{ via: 'celery', task_id: string }>} */
export async function dispatchImportAccount(accountId) {
  const task_id = await enqueueCeleryTask('tasks.imports.import_account', [accountId])
  return { via: 'celery', task_id }
}

export async function dispatchImportTwitterFollowers(accountId) {
  await enqueueCeleryTask('tasks.imports.import_twitter_followers', [accountId])
}

export async function dispatchImportTwitterPosts(accountId, paginationToken = '') {
  await enqueueCeleryTask(
    'tasks.imports.import_twitter_posts',
    paginationToken ? [accountId, paginationToken] : [accountId],
  )
}

export async function dispatchProcessTwitterMetrics(accountId) {
  await enqueueCeleryTask('tasks.analytics.process_twitter_metrics', [accountId])
}

export async function dispatchImportFacebookFollowers(accountId) {
  await enqueueCeleryTask('tasks.imports.import_facebook_followers', [accountId])
}

export async function dispatchImportFacebookInsights(accountId) {
  await enqueueCeleryTask('tasks.imports.import_facebook_insights', [accountId])
}

export async function dispatchImportInstagramFollowers(accountId) {
  await enqueueCeleryTask('tasks.imports.import_instagram_followers', [accountId])
}
