/**
 * SEO keyword rank tracking — targets in Mongo, checks via tasks.seo.check_keyword_ranks.
 */
import { ObjectId } from 'mongodb'
import { getDb } from '../lib/mongo.js'
import { enqueueCeleryAndWaitForJson } from '../lib/p2ExecCeleryReply.js'

const TARGETS = 'seo_keyword_targets'
const SNAPSHOTS = 'seo_keyword_rank_snapshots'

function serializeTarget(row) {
  return {
    id: row._id.toString(),
    keyword: row.keyword,
    target_domain: row.target_domain,
    landing_page_slug: row.landing_page_slug || null,
    locale: row.locale || 'us-en',
    last_position: row.last_position ?? null,
    last_checked_at: row.last_checked_at || null,
    created_at: row.created_at,
  }
}

export async function listKeywordTargets(workspaceId) {
  const rows = await getDb().collection(TARGETS).find({
    workspace_id: String(workspaceId),
    deleted_at: null,
  }).sort({ created_at: -1 }).toArray()
  return rows.map(serializeTarget)
}

export async function addKeywordTarget(workspaceId, {
  keyword,
  target_domain: targetDomain,
  landing_page_slug: landingPageSlug,
  locale,
}) {
  const kw = String(keyword || '').trim()
  const domain = String(targetDomain || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0]
  if (!kw) throw Object.assign(new Error('keyword is required'), { statusCode: 422 })
  if (!domain) throw Object.assign(new Error('target_domain is required'), { statusCode: 422 })

  const now = new Date()
  const doc = {
    workspace_id: String(workspaceId),
    keyword: kw,
    target_domain: domain.replace(/^www\./, ''),
    landing_page_slug: landingPageSlug || null,
    locale: locale || 'us-en',
    last_position: null,
    last_checked_at: null,
    deleted_at: null,
    created_at: now,
    updated_at: now,
  }
  const { insertedId } = await getDb().collection(TARGETS).insertOne(doc)
  return serializeTarget({ _id: insertedId, ...doc })
}

export async function deleteKeywordTarget(workspaceId, targetId) {
  let oid
  try {
    oid = new ObjectId(targetId)
  } catch {
    throw Object.assign(new Error('Invalid target id'), { statusCode: 400 })
  }
  const res = await getDb().collection(TARGETS).updateOne(
    { _id: oid, workspace_id: String(workspaceId), deleted_at: null },
    { $set: { deleted_at: new Date(), updated_at: new Date() } },
  )
  if (!res.matchedCount) throw Object.assign(new Error('Target not found'), { statusCode: 404 })
  return { deleted: true }
}

export async function checkWorkspaceKeywordRanks(workspaceId, { target_ids: targetIds } = {}) {
  const filter = { workspace_id: String(workspaceId), deleted_at: null }
  if (Array.isArray(targetIds) && targetIds.length) {
    const oids = []
    for (const id of targetIds) {
      try {
        oids.push(new ObjectId(id))
      } catch {
        /* skip */
      }
    }
    if (oids.length) filter._id = { $in: oids }
  }

  const targets = await getDb().collection(TARGETS).find(filter).toArray()
  if (!targets.length) {
    return { ok: true, checked: 0, results: [] }
  }

  const json = await enqueueCeleryAndWaitForJson(
    'tasks.seo.check_keyword_ranks',
    [{
      keywords: targets.map((t) => ({
        id: t._id.toString(),
        keyword: t.keyword,
        target_domain: t.target_domain,
      })),
    }],
    { timeoutMs: 180000 },
  )

  if (!json.ok) {
    throw Object.assign(new Error(json.error || 'Rank check failed'), { statusCode: 422 })
  }

  const db = getDb()
  const now = new Date()
  const results = json.results || []
  for (const row of results) {
    if (!row.id) continue
    let oid
    try {
      oid = new ObjectId(row.id)
    } catch {
      continue
    }
    await db.collection(TARGETS).updateOne(
      { _id: oid, workspace_id: String(workspaceId) },
      {
        $set: {
          last_position: row.position,
          last_checked_at: now,
          updated_at: now,
        },
      },
    )
    await db.collection(SNAPSHOTS).insertOne({
      workspace_id: String(workspaceId),
      target_id: row.id,
      keyword: row.keyword,
      target_domain: row.target_domain,
      position: row.position,
      found_url: row.found_url || null,
      engine: row.engine || 'duckduckgo_html',
      error: row.error || null,
      checked_at: now,
    })
  }

  return {
    ok: true,
    checked: results.length,
    results,
  }
}

export async function recentRankSnapshots(workspaceId, { limit = 50 } = {}) {
  const rows = await getDb().collection(SNAPSHOTS).find({
    workspace_id: String(workspaceId),
  }).sort({ checked_at: -1 }).limit(Math.min(Number(limit) || 50, 200)).toArray()

  return rows.map((r) => ({
    id: r._id.toString(),
    target_id: r.target_id,
    keyword: r.keyword,
    target_domain: r.target_domain,
    position: r.position,
    found_url: r.found_url,
    engine: r.engine,
    error: r.error,
    checked_at: r.checked_at,
  }))
}
