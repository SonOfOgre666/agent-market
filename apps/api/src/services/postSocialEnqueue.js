/**
 * UI → worker enqueue helpers (PROJECT_PATTERN).
 * Same Celery task names as registry/tools.json — agent runtime uses identical tasks.
 */
import { enqueueCeleryAndWaitForJson } from '../lib/p2ExecCeleryReply.js'

/** @see services/ai-worker/registry/tools.json */
export const TASK_CREATE_DRAFT = 'tasks.social.create_draft_post'
export const TASK_SCHEDULE_POST = 'tasks.social.schedule_post'
export const TASK_PUBLISH_POST = 'tasks.social.publish_post'

/** Draft only — use TASK_SCHEDULE_POST for delayed publish. */
export async function enqueueCreateDraftPost(payload) {
  const { workspace_id, account_ids, versions } = payload || {}
  return enqueueCeleryAndWaitForJson(TASK_CREATE_DRAFT, [{
    workspace_id,
    account_ids: account_ids || [],
    versions,
  }])
}

/** Same task as agent tool schedule_post. */
export async function enqueueSchedulePost(payload) {
  return enqueueCeleryAndWaitForJson(TASK_SCHEDULE_POST, [payload || {}], { timeoutMs: 120000 })
}
