/**
 * Post persistence (MongoDB) — single implementation layer.
 *
 * Execution paths (no duplicate business logic):
 * - UI POST /api/posts        → enqueueCreateDraftPost → tasks.social.create_draft_post → createPostFromWorkerPayload
 * - UI POST /posts/:id/schedule → enqueueSchedulePost → tasks.social.schedule_post → schedulePostForWorkspace (internal)
 * - UI POST /posts/:id/publish  → dispatchPublishPost → tasks.social.publish_post
 * - Agent tools               → same tasks via lib/dispatch/dispatcher.py
 * - Comment analysis          → services/socialCommentAnalyze.js (API + agent analyze_social_comment)
 */
import fs from 'fs/promises'
import path from 'path'
import { randomBytes } from 'crypto'
import { getDb } from '../lib/mongo.js'
import * as Post from '../models/Post.js'
import * as Account from '../models/Account.js'
import * as Media from '../models/Media.js'
import { publishEvent } from '../lib/events.js'
import { isSocialProvider } from '../constants/accountKinds.js'

const UPLOAD_DIR = process.env.STORAGE_LOCAL_PATH || './uploads'

export async function assertSocialPublishAccounts(workspaceId, accountIds) {
  if (!accountIds?.length) return
  for (const rawId of accountIds) {
    const acc = await Account.findByUuid(rawId) || await Account.findById(rawId)
    if (!acc) {
      throw Object.assign(new Error(`Account not found: ${rawId}`), { statusCode: 404 })
    }
    if (acc.workspace_id && acc.workspace_id !== workspaceId) {
      throw Object.assign(new Error('Account does not belong to this workspace'), { statusCode: 403 })
    }
    if (!Account.isSocialProvider(acc.provider)) {
      throw Object.assign(
        new Error('Posts can only target social pages (not Google Ads or Meta Ads accounts)'),
        { statusCode: 422 },
      )
    }
  }
}

function extForMime(mime) {
  const m = String(mime || '').toLowerCase()
  if (m.includes('png')) return 'png'
  if (m.includes('webp')) return 'webp'
  if (m.includes('gif')) return 'gif'
  if (m.includes('quicktime')) return 'mov'
  if (m.startsWith('video/')) return 'mp4'
  return 'jpg'
}

async function saveBase64MediaDataUrl(dataUrl, workspaceId) {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/s)
  if (!m) return null
  const mime = m[1].toLowerCase()
  const buf = Buffer.from(m[2], 'base64')
  if (!Media.ALLOWED_MIME.includes(mime)) {
    throw Object.assign(
      new Error(`Unsupported media type: ${mime}`),
      { statusCode: 422 },
    )
  }
  const isVideo = mime.startsWith('video/')
  const maxSize = isVideo ? Media.MAX_SIZE.video : mime.includes('gif') ? Media.MAX_SIZE.gif : Media.MAX_SIZE.image
  if (buf.length > maxSize) {
    throw Object.assign(
      new Error(`Media exceeds size limit (${Math.round(maxSize / (1024 * 1024))} MB)`),
      { statusCode: 422 },
    )
  }
  const ext = extForMime(mime)
  const fileName = `agent_${Date.now()}_${randomBytes(4).toString('hex')}.${ext}`
  await fs.mkdir(UPLOAD_DIR, { recursive: true })
  const rel = path.join(String(workspaceId || 'default'), fileName).replace(/\\/g, '/')
  const abs = path.join(UPLOAD_DIR, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, buf)
  return Media.createMedia({
    workspace_id: workspaceId,
    name: fileName,
    mime_type: mime,
    path: rel,
    size: buf.length,
    size_total: buf.length,
  })
}

function mediaEntryFromRow(media, role) {
  return {
    id: media._id.toString(),
    uuid: media.uuid,
    name: media.name,
    mime_type: media.mime_type,
    url: Media.getPublicUrl(media),
    role,
  }
}

function providerQuery(platform) {
  if (!platform) return null
  if (platform === 'facebook') return { $in: ['facebook', 'facebook_page'] }
  if (platform === 'instagram') return { $in: ['instagram', 'instagram_login'] }
  return platform
}

export function postHasVideoMedia(post) {
  for (const version of post?.versions || []) {
    for (const block of version?.content || []) {
      if (block.type !== 'media') continue
      for (const item of block.media || []) {
        const mime = String(item.mime_type || '').toLowerCase()
        const role = String(item.role || '').toLowerCase()
        if (role === 'video' || mime.startsWith('video/')) return true
      }
    }
  }
  return false
}

async function filterAccountIdsForPostMedia(post, accountIds) {
  if (postHasVideoMedia(post)) return accountIds
  const filtered = []
  for (const id of accountIds) {
    const acc = await Account.findByUuid(id) || await Account.findById(id)
    if (acc?.provider === 'tiktok') continue
    filtered.push(id)
  }
  return filtered
}

export async function resolveSocialAccountIds(workspaceId, { account_ids: accountIds = [], platform } = {}) {
  let ids = Array.isArray(accountIds) ? accountIds.map(String).filter(Boolean) : []
  if (ids.length) {
    await assertSocialPublishAccounts(workspaceId, ids)
    return ids
  }

  const provFilter = providerQuery(platform)
  const q = { workspace_id: workspaceId, authorized: true }
  if (provFilter) q.provider = provFilter
  const rows = await getDb().collection('accounts').find(q).sort({ created_at: 1 }).limit(10).toArray()
  const social = rows.filter((a) => isSocialProvider(a.provider))
  if (!social.length) return []
  return [social[0]._id.toString()]
}

/** Resolve target pages for schedule/publish — payload accounts override post; platform fills when omitted. */
export async function resolveAccountsForScheduleOrPublish(
  workspaceId,
  post,
  { account_ids: accountIds, platform } = {},
) {
  const explicit = Array.isArray(accountIds) ? accountIds.map(String).filter(Boolean) : []
  if (explicit.length) {
    await assertSocialPublishAccounts(workspaceId, explicit)
    return explicit
  }
  if (post?.account_ids?.length) {
    return post.account_ids.map(String)
  }
  const resolved = await resolveSocialAccountIds(workspaceId, { platform })
  if (!resolved.length) {
    const plat = platform ? String(platform) : null
    throw Object.assign(
      new Error(
        plat
          ? `Select at least one connected page for ${plat} before scheduling or publishing.`
          : 'Select at least one connected page before scheduling or publishing.',
      ),
      { statusCode: 422 },
    )
  }
  return resolved
}

async function mediaEntryFromLibraryId(workspaceId, mediaId, role) {
  if (!mediaId) return null
  const media = await Media.findById(String(mediaId))
  if (!media) {
    throw Object.assign(new Error(`Media not found: ${mediaId}`), { statusCode: 404 })
  }
  if (media.workspace_id && media.workspace_id !== workspaceId) {
    throw Object.assign(new Error('Media does not belong to this workspace'), { statusCode: 403 })
  }
  return mediaEntryFromRow(media, role)
}

export async function buildVersionsFromAgentFields({
  workspace_id,
  caption,
  hashtags,
  media_id,
  thumbnail_media_id,
  image_data_url,
  image,
  video_data_url,
  video,
  thumbnail_data_url,
  thumbnail,
}) {
  let text = String(caption || '').trim()
  if (Array.isArray(hashtags) && hashtags.length) {
    const line = hashtags.map((t) => (String(t).startsWith('#') ? String(t) : `#${t}`)).join(' ')
    text = text ? `${text}\n\n${line}` : line
  }

  const content = [{ type: 'text', body: text || '(no caption)' }]
  const mediaRows = []

  if (media_id) {
    const libraryMedia = await mediaEntryFromLibraryId(
      workspace_id,
      media_id,
      null,
    )
    if (libraryMedia) {
      const mime = String(libraryMedia.mime_type || '')
      libraryMedia.role = mime.startsWith('video/') ? 'video' : 'image'
      mediaRows.push(libraryMedia)
    }
  }

  if (thumbnail_media_id) {
    const thumbMedia = await mediaEntryFromLibraryId(
      workspace_id,
      thumbnail_media_id,
      'thumbnail',
    )
    if (thumbMedia) {
      mediaRows.push(thumbMedia)
    }
  }

  const videoDataUrl = !media_id && (video_data_url || video)
  if (videoDataUrl) {
    const media = await saveBase64MediaDataUrl(videoDataUrl, workspace_id)
    if (!media) {
      throw Object.assign(
        new Error('Generated video could not be saved — invalid or missing video data'),
        { statusCode: 422 },
      )
    }
    mediaRows.push(mediaEntryFromRow(media, 'video'))
  }

  const thumbDataUrl = !media_id && (thumbnail_data_url || thumbnail)
  const imageDataUrl = !media_id && (thumbDataUrl || image_data_url || image)
  if (imageDataUrl) {
    const media = await saveBase64MediaDataUrl(imageDataUrl, workspace_id)
    if (!media) {
      throw Object.assign(
        new Error('Generated image could not be saved — invalid or missing image data'),
        { statusCode: 422 },
      )
    }
    const role = videoDataUrl ? 'thumbnail' : 'image'
    mediaRows.push(mediaEntryFromRow(media, role))
  }

  if (mediaRows.length) {
    content.push({ type: 'media', media: mediaRows })
  }

  return [{ is_original: true, account_id: null, content }]
}

export function resolveScheduledAt({ scheduled_at, schedule_in_minutes }) {
  let scheduledAt = scheduled_at ? new Date(scheduled_at) : null
  const mins = Number(schedule_in_minutes)
  if (!scheduledAt && Number.isFinite(mins) && mins > 0) {
    scheduledAt = new Date(Date.now() + mins * 60 * 1000)
  }
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
    throw Object.assign(new Error('Invalid scheduled_at'), { statusCode: 422 })
  }
  return scheduledAt
}

/**
 * Schedule an existing draft post — shared by UI POST /posts/:id/schedule and agent schedule_post task.
 */
export async function schedulePostForWorkspace({
  workspace_id,
  post_id,
  scheduled_at,
  schedule_in_minutes,
  account_ids,
  platform,
}) {
  if (!workspace_id) {
    throw Object.assign(new Error('workspace_id is required'), { statusCode: 400 })
  }
  if (!post_id) {
    throw Object.assign(new Error('post_id is required'), { statusCode: 400 })
  }

  const post = await Post.findById(String(post_id), workspace_id)
  if (!post) {
    throw Object.assign(new Error('Post not found'), { statusCode: 404 })
  }

  if (post.status === Post.PostStatus.PUBLISHED || post.status === Post.PostStatus.FAILED) {
    throw Object.assign(
      new Error('This post has already been published and cannot be rescheduled.'),
      { statusCode: 422 },
    )
  }
  if (post.schedule_status === Post.ScheduleStatus.PROCESSING) {
    throw Object.assign(new Error('This post is currently being published.'), { statusCode: 422 })
  }

  const scheduledDate = resolveScheduledAt({ scheduled_at, schedule_in_minutes })
  if (!scheduledDate) {
    throw Object.assign(
      new Error('scheduled_at or schedule_in_minutes is required'),
      { statusCode: 422 },
    )
  }
  if (scheduledDate <= new Date()) {
    throw Object.assign(new Error('The scheduled date cannot be in the past.'), { statusCode: 422 })
  }

  const resolvedAccountIds = await filterAccountIdsForPostMedia(
    post,
    await resolveAccountsForScheduleOrPublish(workspace_id, post, {
      account_ids,
      platform,
    }),
  )
  if (!resolvedAccountIds.length) {
    throw Object.assign(
      new Error('TikTok requires a video post. Add a video or choose other accounts.'),
      { statusCode: 422 },
    )
  }

  const updated = await Post.updatePost(post._id.toString(), {
    account_ids: resolvedAccountIds,
    status: Post.PostStatus.SCHEDULED,
    schedule_status: Post.ScheduleStatus.PENDING,
    scheduled_at: scheduledDate,
  })

  await publishEvent('post.scheduled', {
    post_id: String(post._id),
    scheduled_at: scheduledDate.toISOString(),
  }).catch(() => {})

  return {
    post_id: updated._id.toString(),
    uuid: updated.uuid,
    status: updated.status,
    scheduled_at: updated.scheduled_at ? new Date(updated.scheduled_at).toISOString() : null,
    account_ids: resolvedAccountIds,
  }
}

/** Reset failed or stuck posts so publish can run again. */
export async function normalizePostBeforePublish(post) {
  if (!post) {
    throw Object.assign(new Error('Post not found'), { statusCode: 404 })
  }

  if (post.status === Post.PostStatus.PUBLISHED) {
    throw Object.assign(
      new Error('This post was already published. Save your edits, then publish again to post the updated version.'),
      { statusCode: 422 },
    )
  }

  const needsReset =
    post.status === Post.PostStatus.FAILED
    || post.schedule_status === Post.ScheduleStatus.PROCESSING

  if (!needsReset) return post

  return Post.updatePost(post._id.toString(), {
    status: Post.PostStatus.DRAFT,
    schedule_status: Post.ScheduleStatus.PENDING,
  })
}

/**
 * Attach target pages and mark a post ready to publish — shared by UI and agent publish_post.
 */
export async function preparePublishPostForWorkspace({
  workspace_id,
  post_id,
  account_ids,
  platform,
}) {
  if (!workspace_id) {
    throw Object.assign(new Error('workspace_id is required'), { statusCode: 400 })
  }
  if (!post_id) {
    throw Object.assign(new Error('post_id is required'), { statusCode: 400 })
  }

  const post = await Post.findById(String(post_id), workspace_id)
  if (!post) {
    throw Object.assign(new Error('Post not found'), { statusCode: 404 })
  }

  const publishable = await normalizePostBeforePublish(post)
  if (publishable.schedule_status === Post.ScheduleStatus.PROCESSING) {
    throw Object.assign(new Error('This post is currently being published.'), { statusCode: 422 })
  }

  const resolvedAccountIds = await filterAccountIdsForPostMedia(
    publishable,
    await resolveAccountsForScheduleOrPublish(workspace_id, publishable, {
      account_ids,
      platform,
    }),
  )
  if (!resolvedAccountIds.length) {
    throw Object.assign(
      new Error('TikTok requires a video post. Add a video or choose other accounts.'),
      { statusCode: 422 },
    )
  }

  await Post.updatePost(publishable._id.toString(), {
    account_ids: resolvedAccountIds,
    schedule_status: Post.ScheduleStatus.PROCESSING,
  })

  return {
    post_id: publishable._id.toString(),
    account_ids: resolvedAccountIds,
  }
}

/**
 * Same persistence path as POST /api/posts — UI and agent both call this.
 */
export async function createPostForWorkspace({
  workspace_id,
  account_ids = [],
  versions,
  scheduled_at,
  schedule_in_minutes,
}) {
  if (!workspace_id) {
    throw Object.assign(new Error('workspace_id is required'), { statusCode: 400 })
  }
  if (!versions?.length) {
    throw Object.assign(new Error('Post content is required'), { statusCode: 422 })
  }

  await assertSocialPublishAccounts(workspace_id, account_ids)

  const scheduledAt = resolveScheduledAt({ scheduled_at, schedule_in_minutes })

  const post = await Post.createPost({
    workspace_id,
    account_ids,
    versions,
    scheduled_at: scheduledAt,
    status: scheduledAt ? Post.PostStatus.SCHEDULED : undefined,
  })

  if (scheduledAt) {
    await publishEvent('post.scheduled', {
      post_id: String(post._id),
      scheduled_at: scheduledAt.toISOString(),
    }).catch(() => {})
  }

  return post
}

/** Unified entry for worker task — UI shape (versions) or agent shape (caption/hashtags/image). Draft only; use schedule_post to schedule. */
export async function createPostFromWorkerPayload(body) {
  if (Array.isArray(body?.versions) && body.versions.length) {
    const post = await createPostForWorkspace({
      workspace_id: body.workspace_id,
      account_ids: body.account_ids || [],
      versions: body.versions,
    })
    const postId = post._id.toString()
    return {
      id: postId,
      uuid: post.uuid,
      status: post.status,
      scheduled_at: post.scheduled_at ? new Date(post.scheduled_at).toISOString() : null,
      account_ids: body.account_ids || [],
    }
  }
  return createPostFromAgentPayload(body)
}

/** Agent planner payload → same createPostForWorkspace as the UI. */
export async function createPostFromAgentPayload(body) {
  const workspaceId = body.workspace_id ? String(body.workspace_id) : null
  if (!workspaceId) {
    throw Object.assign(new Error('workspace_id is required'), { statusCode: 400 })
  }

  let accountIds = []
  if (body.account_ids?.length || body.platform) {
    accountIds = await resolveSocialAccountIds(workspaceId, {
      account_ids: body.account_ids,
      platform: body.platform,
    })
  }

  const versions = await buildVersionsFromAgentFields({
    workspace_id: workspaceId,
    caption: body.caption,
    hashtags: body.hashtags,
    media_id: body.media_id,
    thumbnail_media_id: body.thumbnail_media_id,
    image_data_url: body.image_data_url,
    image: body.image,
    video_data_url: body.video_data_url,
    video: body.video,
    thumbnail_data_url: body.thumbnail_data_url,
    thumbnail: body.thumbnail,
  })

  const post = await createPostForWorkspace({
    workspace_id: workspaceId,
    account_ids: accountIds,
    versions,
  })

  const postId = post._id.toString()
  return {
    id: postId,
    uuid: post.uuid,
    status: post.status,
    scheduled_at: post.scheduled_at ? new Date(post.scheduled_at).toISOString() : null,
    account_ids: accountIds,
  }
}
