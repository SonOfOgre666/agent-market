/**
 * LLM via tasks.ai.gemini_sync (analyze_comment). Fails when AI is unavailable.
 */
import { enqueueCeleryAndWaitForJson } from '../lib/p2ExecCeleryReply.js'
import {
  createManual,
  listForWorkspace,
} from './postComments.js'

/** @deprecated use postComments.COLLECTION */
export const COMMENTS_COLLECTION = 'post_comments'

/** Run LLM analysis only — does not persist. */
export async function analyzeSocialComment({
  comment,
  platform = 'instagram',
  post_context: postContext = '',
  workspace_id: workspaceId = null,
  userId = null,
  execution_source: executionSource = 'api',
}) {
  const trimmed = String(comment || '').trim()
  if (!trimmed) {
    throw Object.assign(new Error('comment is required'), { statusCode: 422 })
  }

  const payload = {
    comment: trimmed,
    platform,
    post_context: postContext || '',
    workspace_id: workspaceId,
    userId,
    execution_source: executionSource,
  }

  try {
    const json = await enqueueCeleryAndWaitForJson(
      'tasks.ai.gemini_sync',
      ['analyze_comment', payload],
      { timeoutMs: 90000 },
    )
    if (json.ok && json.data) {
      return { ...json.data, source: json.data.source || 'llm' }
    }
    throw Object.assign(new Error(json.error || 'Comment analysis failed'), { statusCode: 422 })
  } catch (err) {
    if (err.statusCode) throw err
    throw Object.assign(new Error(err.message || 'Comment analysis failed'), { statusCode: 502 })
  }
}

export async function analyzeAndPersistComment(params) {
  return createManual(params)
}

export async function listCommentAnalyses({
  workspace_id: workspaceId,
  userId: _userId,
  limit = 30,
  synced_only = false,
} = {}) {
  if (!workspaceId) return []
  return listForWorkspace(workspaceId, { limit, synced_only })
}
