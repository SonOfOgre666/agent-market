/**
 * Post-linked social comments — sync, manual paste, analysis, reply.
 * LLM analysis reuses analyzeSocialComment from socialCommentAnalyze.js.
 */
import { getDb } from '../lib/mongo.js'
import { nanoid } from 'nanoid'
import { publishEvent } from '../lib/events.js'
import { enqueueCeleryTask } from '../lib/celeryEnqueue.js'
import * as Setting from '../models/Setting.js'
import { analyzeSocialComment } from './socialCommentAnalyze.js'

export const COLLECTION = 'post_comments'

const ANALYSIS_PENDING = 'pending'
const ANALYSIS_DONE = 'done'
const ANALYSIS_FAILED = 'failed'
const ANALYSIS_SKIPPED = 'skipped'

export function postCaptionContext(post) {
  if (!post?.versions?.length) return ''
  const orig = post.versions.find((v) => v.is_original) || post.versions[0]
  const block = orig?.content?.find((b) => b.type === 'text')
  return (block?.body || '').trim().slice(0, 500)
}

function emptyAnalysis(status = ANALYSIS_SKIPPED) {
  return {
    sentiment: null,
    summary: null,
    topics: [],
    urgency: null,
    proposed_replies: [],
    analyzed_at: null,
    analysis_status: status,
    error: null,
    source: null,
  }
}

export function serializeComment(row) {
  if (!row) return null
  const analysis = row.analysis || emptyAnalysis()
  return {
    id: row.uuid,
    source: row.source || 'sync',
    post_id: row.post_id || null,
    account_id: row.account_id || null,
    provider: row.provider || null,
    provider_post_id: row.provider_post_id || null,
    provider_comment_id: row.provider_comment_id || null,
    author: row.author || null,
    comment: row.comment || row.text || '',
    post_context: row.post_context || null,
    platform_created_at: row.platform_created_at || null,
    analysis,
    reply: row.reply || { status: 'none' },
    reply_supported: row.reply_supported !== false,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export async function findByUuid(uuid, workspace_id) {
  const filter = { uuid: String(uuid) }
  if (workspace_id) filter.workspace_id = workspace_id
  return getDb().collection(COLLECTION).findOne(filter)
}

export async function listForPost(post_id, workspace_id, { limit = 100 } = {}) {
  const rows = await getDb().collection(COLLECTION)
    .find({ workspace_id, post_id: String(post_id) })
    .sort({ platform_created_at: -1, created_at: -1 })
    .limit(Math.min(Number(limit) || 100, 200))
    .toArray()
  return rows.map(serializeComment)
}

export async function listForWorkspace(workspace_id, { limit = 30, post_id, source, synced_only = false } = {}) {
  const filter = { workspace_id }
  if (post_id) filter.post_id = String(post_id)
  if (source) filter.source = String(source)
  if (synced_only) filter.source = 'sync'
  const rows = await getDb().collection(COLLECTION)
    .find(filter)
    .sort({ platform_created_at: -1, created_at: -1 })
    .limit(Math.min(Number(limit) || 30, 100))
    .toArray()
  return rows.map(serializeComment)
}

async function patchAnalysis(uuid, workspace_id, analysis, extra = {}) {
  const now = new Date()
  await getDb().collection(COLLECTION).updateOne(
    { uuid, workspace_id },
    { $set: { analysis, updated_at: now, ...extra } },
  )
}

export async function runAnalysisForRecord(record, {
  userId = null,
  execution_source = 'api',
  post_context: postContextOverride,
} = {}) {
  const workspaceId = record.workspace_id
  const postContext = postContextOverride ?? record.post_context ?? ''
  const now = new Date()
  await patchAnalysis(record.uuid, workspaceId, {
    ...emptyAnalysis(ANALYSIS_PENDING),
  })

  try {
    const out = await analyzeSocialComment({
      comment: record.comment || record.text,
      platform: record.provider || record.platform || 'instagram',
      post_context: postContext,
      workspace_id: workspaceId,
      userId,
      execution_source,
    })
    const analysis = {
      sentiment: out.sentiment,
      summary: out.summary,
      topics: out.topics || [],
      urgency: out.urgency,
      proposed_replies: out.proposed_replies || [],
      analyzed_at: now,
      analysis_status: ANALYSIS_DONE,
      error: null,
      source: out.source || 'llm',
    }
    await patchAnalysis(record.uuid, workspaceId, analysis)
    await publishEvent('comment.analyzed', {
      commentId: record.uuid,
      postId: record.post_id || null,
      userId,
      workspace_id: workspaceId,
      sentiment: analysis.sentiment,
      source: analysis.source,
    })
    return { ...serializeComment({ ...record, analysis, updated_at: now }), ...out }
  } catch (err) {
    const analysis = {
      ...emptyAnalysis(ANALYSIS_FAILED),
      error: err.message || 'Analysis failed',
    }
    await patchAnalysis(record.uuid, workspaceId, analysis)
    throw err
  }
}

export async function maybeEnqueueAutoAnalyze(workspace_id, commentUuid) {
  const enabled = await Setting.get('auto_analyze_comments', workspace_id)
  if (!enabled) return false
  await enqueueCeleryTask('tasks.social.analyze_post_comment', [commentUuid])
  return true
}

export async function createManual({
  comment,
  platform,
  post_context: postContext,
  workspace_id: workspaceId,
  userId,
  execution_source: executionSource = 'api_posts',
}) {
  const trimmed = String(comment || '').trim()
  if (!trimmed) {
    throw Object.assign(new Error('comment is required'), { statusCode: 422 })
  }
  const now = new Date()
  const record = {
    uuid: nanoid(),
    source: 'manual',
    workspace_id: workspaceId,
    userId: userId || null,
    post_id: null,
    account_id: null,
    provider: platform || 'instagram',
    provider_post_id: null,
    provider_comment_id: null,
    comment: trimmed,
    post_context: postContext || null,
    platform_created_at: null,
    author: null,
    reply_supported: false,
    analysis: emptyAnalysis(ANALYSIS_PENDING),
    reply: { status: 'none' },
    created_at: now,
    updated_at: now,
  }
  await getDb().collection(COLLECTION).insertOne(record)
  const out = await runAnalysisForRecord(record, { userId, execution_source: executionSource })
  return out
}

export async function upsertSynced({
  workspace_id,
  post_id,
  account_id,
  provider,
  provider_post_id,
  provider_comment_id,
  comment,
  author,
  platform_created_at,
  post_context,
  reply_supported = true,
}) {
  const text = String(comment || '').trim()
  if (!text || !provider_comment_id) {
    throw Object.assign(new Error('comment and provider_comment_id are required'), { statusCode: 422 })
  }
  const now = new Date()
  const filter = {
    workspace_id,
    account_id: String(account_id),
    provider_comment_id: String(provider_comment_id),
  }
  const existing = await getDb().collection(COLLECTION).findOne(filter)
  const autoAnalyze = await Setting.get('auto_analyze_comments', workspace_id)
  const pendingOrSkipped = autoAnalyze ? ANALYSIS_PENDING : ANALYSIS_SKIPPED
  if (existing && existing.comment === text && existing.analysis?.analysis_status === ANALYSIS_DONE) {
    return { record: existing, isNew: false }
  }

  const setFields = {
    workspace_id,
    post_id: String(post_id),
    account_id: String(account_id),
    provider,
    provider_post_id: String(provider_post_id),
    provider_comment_id: String(provider_comment_id),
    comment: text,
    author: author || null,
    platform_created_at: platform_created_at ? new Date(platform_created_at) : null,
    post_context: post_context || null,
    source: 'sync',
    reply_supported: reply_supported !== false,
    updated_at: now,
  }

  if (!existing) {
    const record = {
      uuid: nanoid(),
      ...setFields,
      analysis: emptyAnalysis(pendingOrSkipped),
      reply: { status: 'none' },
      created_at: now,
    }
    await getDb().collection(COLLECTION).insertOne(record)
    await maybeEnqueueAutoAnalyze(workspace_id, record.uuid)
    await publishEvent('comment.synced', {
      commentId: record.uuid,
      postId: record.post_id,
      workspace_id,
      provider,
    })
    return { record, isNew: true }
  }

  const needsReanalysis = existing.comment !== text
  const analysis = needsReanalysis
    ? emptyAnalysis(pendingOrSkipped)
    : (existing.analysis || emptyAnalysis(ANALYSIS_SKIPPED))

  await getDb().collection(COLLECTION).updateOne(
    { _id: existing._id },
    { $set: { ...setFields, analysis } },
  )
  const record = { ...existing, ...setFields, analysis }
  if (needsReanalysis) {
    await maybeEnqueueAutoAnalyze(workspace_id, record.uuid)
  }
  return { record, isNew: false }
}

export async function markReplyPending(uuid, workspace_id, text) {
  const now = new Date()
  await getDb().collection(COLLECTION).updateOne(
    { uuid, workspace_id },
    {
      $set: {
        reply: { status: 'pending', text: String(text).trim(), sent_at: null, provider_reply_id: null, error: null },
        updated_at: now,
      },
    },
  )
}

export async function applyReplyResult(uuid, workspace_id, { ok, provider_reply_id, error }) {
  const now = new Date()
  const doc = await findByUuid(uuid, workspace_id)
  const prev = doc?.reply || {}
  await getDb().collection(COLLECTION).updateOne(
    { uuid, workspace_id },
    {
      $set: {
        reply: {
          ...prev,
          status: ok ? 'sent' : 'failed',
          provider_reply_id: provider_reply_id || null,
          sent_at: ok ? now : prev.sent_at || null,
          error: error || null,
        },
        updated_at: now,
      },
    },
  )
}
