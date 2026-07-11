/**
 * SEO keyword clustering by search intent — LLM via Google Ads Marketing feature.
 */
import { getDb } from '../lib/mongo.js'
import { enqueueCeleryAndWaitForJson } from '../lib/p2ExecCeleryReply.js'

const COLLECTION = 'seo_keyword_clusters'

export async function clusterSeoKeywords(workspaceId, {
  seed_keywords: seedKeywords = [],
  business_context: businessContext = '',
  locale = 'en-US',
} = {}) {
  const seeds = (Array.isArray(seedKeywords) ? seedKeywords : [])
    .map((k) => String(k || '').trim())
    .filter(Boolean)
  if (!seeds.length) {
    throw Object.assign(new Error('seed_keywords array is required'), { statusCode: 422 })
  }

  const json = await enqueueCeleryAndWaitForJson(
    'tasks.ai.gemini_sync',
    ['seo_keyword_clusters', {
      workspace_id: workspaceId,
      seed_keywords: seeds.slice(0, 30),
      business_context: String(businessContext || '').slice(0, 2000),
      locale,
    }],
    { timeoutMs: 120000 },
  )

  if (!json.ok) {
    throw Object.assign(new Error(json.error || 'Keyword clustering failed'), { statusCode: 422 })
  }

  const clusters = json.data?.clusters || []
  const summary = json.data?.summary || ''
  const doc = {
    workspace_id: String(workspaceId),
    seed_keywords: seeds,
    business_context: businessContext || null,
    clusters,
    summary,
    source: json.data?.source || 'llm',
    created_at: new Date(),
  }
  const { insertedId } = await getDb().collection(COLLECTION).insertOne(doc)
  return {
    id: insertedId.toString(),
    clusters,
    summary,
    source: doc.source,
  }
}

export async function listRecentKeywordClusters(workspaceId, { limit = 5 } = {}) {
  const rows = await getDb().collection(COLLECTION).find({
    workspace_id: String(workspaceId),
  }).sort({ created_at: -1 }).limit(Math.min(Number(limit) || 5, 20)).toArray()

  return rows.map((r) => ({
    id: r._id.toString(),
    seed_keywords: r.seed_keywords || [],
    clusters: r.clusters || [],
    source: r.source,
    created_at: r.created_at,
  }))
}
