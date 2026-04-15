import { getDb } from '../db/mongodb.js'
import { upsert as upsertMetric } from '../models/Metric.js'

/**
 * Aggregates imported Mastodon statuses into daily metrics.
 * Mirrors ProcessMastodonMetricsJob: groups by date, sums replies/reblogs/favourites.
 */
export async function processMastodonMetricsJob({ account_id }) {
  const db = getDb()

  const rows = await db.collection('imported_posts').aggregate([
    { $match: { account_id } },
    {
      $group: {
        _id:        { $substr: ['$content.created_at', 0, 10] },
        replies:    { $sum: '$metrics.replies' },
        reblogs:    { $sum: '$metrics.reblogs' },
        favourites: { $sum: '$metrics.favourites' },
      },
    },
    { $sort: { _id: 1 } },
  ]).toArray()

  for (const row of rows) {
    await upsertMetric(account_id, row._id, {
      replies:    row.replies,
      reblogs:    row.reblogs,
      favourites: row.favourites,
    })
  }

  console.log(`[ProcessMastodonMetrics] account=${account_id} days=${rows.length}`)
}
