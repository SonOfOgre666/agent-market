import { getDb } from '../db/mongodb.js'
import { upsert as upsertMetric } from '../models/Metric.js'

/**
 * Aggregates imported Twitter posts into daily metrics.
 * Mirrors ProcessTwitterMetricsJob: groups ImportedPost by date, sums likes/replies/retweets/impressions.
 */
export async function processTwitterMetricsJob({ account_id }) {
  const db = getDb()

  const rows = await db.collection('imported_posts').aggregate([
    { $match: { account_id } },
    {
      $group: {
        _id: { $substr: ['$created_at', 0, 10] }, // group by date string YYYY-MM-DD
        likes:       { $sum: '$metrics.likes' },
        replies:     { $sum: '$metrics.replies' },
        retweets:    { $sum: '$metrics.retweets' },
        impressions: { $sum: '$metrics.impressions' },
      },
    },
    { $sort: { _id: 1 } },
  ]).toArray()

  for (const row of rows) {
    await upsertMetric(account_id, row._id, {
      likes:       row.likes,
      replies:     row.replies,
      retweets:    row.retweets,
      impressions: row.impressions,
    })
  }

  console.log(`[ProcessTwitterMetrics] account=${account_id} days=${rows.length}`)
}
