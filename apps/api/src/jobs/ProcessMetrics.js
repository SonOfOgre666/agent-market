import { findById as findAccount } from '../models/Account.js'
import { getSocialProvider } from '../providers/index.js'
import { upsert as upsertMetric, upsertFacebookInsight } from '../models/Metric.js'

export async function processMetricsJob({ account_id }) {
  const account = await findAccount(account_id)
  if (!account || !account.authorized) return

  try {
    const provider = await getSocialProvider(account.provider, {}, account)
    const today = new Date().toISOString().split('T')[0]

    // Generic metrics (impressions, engagements, etc.)
    if (typeof provider.getMetrics === 'function') {
      const metrics = await provider.getMetrics()
      if (metrics) await upsertMetric(account_id, today, metrics)
    }

    // Facebook-specific insights
    if (account.provider === 'facebook' && typeof provider.getPageInsights === 'function') {
      const insights = await provider.getPageInsights()
      for (const insight of insights) {
        await upsertFacebookInsight(account_id, insight.type, insight.value, today)
      }
    }
  } catch (err) {
    console.error(`[ProcessMetrics] account ${account_id} failed:`, err.message)
    throw err
  }
}
