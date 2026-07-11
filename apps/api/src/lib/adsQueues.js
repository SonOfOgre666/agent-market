import { enqueueCeleryTask } from '../lib/celeryEnqueue.js'

/** @deprecated Redis queue keys removed — tasks enqueue Celery directly. */
export const ASSETS_QUEUE = 'agentmarket:ads:assets_queue'
export const LANDING_PAGE_QUEUE = 'agentmarket:ads:landing_page_queue'
export const OPTIMIZATION_QUEUE = 'agentmarket:ads:optimization_queue'

export async function enqueueOptimizeCampaign(campaignId) {
  return enqueueCeleryTask('tasks.optimize_campaign', [String(campaignId)])
}

export async function enqueueLandingPageContentGeneration({
  landingPageId,
  campaignName,
  workspaceId,
  keywords = [],
  language = 'en',
}) {
  return enqueueCeleryTask('tasks.generate_landing_page_content', [
    String(landingPageId),
    String(campaignName),
    String(workspaceId),
    keywords,
    String(language),
  ])
}
