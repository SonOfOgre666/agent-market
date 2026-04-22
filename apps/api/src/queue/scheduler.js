import cron from 'node-cron'
import { findAll as findAllAccounts } from '../models/Account.js'
import { getRedis } from '../db/redis.js'
import { sendWeeklyReport } from '../services/mailer.js'
import { findScheduledReady, updatePost, ScheduleStatus } from '../models/Post.js'
import {
  dispatchPublishPost,
  dispatchImportTwitterFollowers,
  dispatchImportTwitterPosts,
  dispatchProcessTwitterMetrics,
  dispatchImportFacebookFollowers,
  dispatchImportFacebookInsights,
  dispatchImportInstagramFollowers,
} from './dispatcher.js'

export async function startScheduler() {
  // --- Every minute: publish posts that are due ---
  // Mirrors Laravel's RunScheduledPosts command
  cron.schedule('* * * * *', async () => {
    try {
      const posts = await findScheduledReady()
      for (const post of posts) {
        await updatePost(post._id.toString(), { schedule_status: ScheduleStatus.PROCESSING })
        await dispatchPublishPost(post._id.toString())
      }
      if (posts.length) console.log(`[Scheduler] Queued ${posts.length} post(s) for publishing`)
    } catch (err) {
      console.error('[Scheduler] publish-check error:', err.message)
    }
  })

  // --- Every hour: import followers / audience per provider ---
  // Mirrors ImportAccountAudience artisan command
  cron.schedule('0 * * * *', async () => {
    try {
      const accounts = await findAllAccounts()
      for (const account of accounts) {
        if (!account.authorized) continue
        if (account.provider === 'twitter')   await dispatchImportTwitterFollowers(account._id.toString())
        if (account.provider === 'facebook')  await dispatchImportFacebookFollowers(account._id.toString())
        if (account.provider === 'instagram') await dispatchImportInstagramFollowers(account._id.toString())
      }
    } catch (err) {
      console.error('[Scheduler] import-followers error:', err.message)
    }
  })

  // --- Every 6 hours: import posts from providers ---
  // Mirrors ImportAccountData artisan command
  cron.schedule('0 */6 * * *', async () => {
    try {
      const accounts = await findAllAccounts()
      for (const account of accounts) {
        if (!account.authorized) continue
        if (account.provider === 'twitter')  await dispatchImportTwitterPosts(account._id.toString())
      }
    } catch (err) {
      console.error('[Scheduler] import-posts error:', err.message)
    }
  })

  // --- Every day at midnight UTC: aggregate metrics + Facebook insights ---
  // Mirrors ProcessMetrics artisan command
  cron.schedule('0 0 * * *', async () => {
    try {
      const accounts = await findAllAccounts()
      for (const account of accounts) {
        if (!account.authorized) continue
        if (account.provider === 'twitter')  await dispatchProcessTwitterMetrics(account._id.toString())
        if (account.provider === 'facebook') {
          await dispatchImportFacebookFollowers(account._id.toString())
          await dispatchImportFacebookInsights(account._id.toString())
        }
      }
    } catch (err) {
      console.error('[Scheduler] process-metrics error:', err.message)
    }
  })

  // --- Every day at 3am UTC: prune temp upload directory ---
  // Mirrors PruneTemporaryDirectory artisan command
  cron.schedule('0 3 * * *', async () => {
    try {
      const { default: fs } = await import('fs/promises')
      const { default: path } = await import('path')
      const tmpDir = path.join(process.cwd(), 'uploads', '.tmp')
      const files = await fs.readdir(tmpDir).catch(() => [])
      const cutoff = Date.now() - 24 * 60 * 60 * 1000 // older than 24h
      for (const file of files) {
        const fp = path.join(tmpDir, file)
        const stat = await fs.stat(fp).catch(() => null)
        if (stat && stat.mtimeMs < cutoff) await fs.unlink(fp).catch(() => {})
      }
    } catch (err) {
      console.error('[Scheduler] prune-tmp error:', err.message)
    }
  })

  // --- Every day at 4am UTC: delete old imported data (>95 days) ---
  // Mirrors DeleteOldData artisan command:
  //   ImportedPost::where('created_at', '<', now()->subDays(95))->delete()
  //   FacebookInsight::where('date', '<', now()->subDays(95))->delete()
  cron.schedule('0 4 * * *', async () => {
    try {
      const { getDb } = await import('../db/mongodb.js')
      const db = getDb()
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - 95)
      const cutoffStr = cutoff.toISOString().split('T')[0]

      const [ip, fi] = await Promise.all([
        db.collection('imported_posts').deleteMany({ created_at: { $lt: cutoff } }),
        db.collection('facebook_insights').deleteMany({ date: { $lt: cutoffStr } }),
      ])
      console.log(`[Scheduler] delete-old-data: removed ${ip.deletedCount} imported_posts, ${fi.deletedCount} facebook_insights`)
    } catch (err) {
      console.error('[Scheduler] delete-old-data error:', err.message)
    }
  })

  // --- Every hour: check campaign budget thresholds and fire alerts ---
  cron.schedule('0 * * * *', async () => {
    try {
      const redis = getRedis()
      // Find all active campaigns across all workspaces
      const db = (await import('../db/mongodb.js')).getDb()
      const campaigns = await db.collection('ads_campaigns').find({
        deleted_at: null,
        status: { $in: ['active', 'paused'] },
        'budget.amount': { $gt: 0 },
      }).toArray()

      const THRESHOLDS = [80, 90, 100]

      for (const c of campaigns) {
        const budget = c.budget?.amount || 0
        if (!budget) continue
        const spend = c.metrics?.spend || 0
        const pct = Math.floor((spend / budget) * 100)

        for (const threshold of THRESHOLDS) {
          if (pct < threshold) continue
          const alertKey = `budget_alert:${c._id}:${threshold}`
          const alreadySent = await redis.get(alertKey)
          if (alreadySent) continue

          // Mark as sent (24h TTL so it re-alerts next day if still over budget)
          await redis.set(alertKey, '1', 'EX', 86400)
          await redis.publish('agentmarket:budget_alert', JSON.stringify({
            campaign_id: c._id.toString(),
            campaign_name: c.name,
            percent: threshold,
            spend,
            budget,
            workspace_id: c.workspace_id,
          }))
          console.log(`[Scheduler] Budget alert: campaign "${c.name}" at ${threshold}%`)
        }
      }
    } catch (err) {
      console.error('[Scheduler] budget-alert error:', err.message)
    }
  })

  // --- Every Monday at 8am UTC: send weekly KPI email report ---
  cron.schedule('0 8 * * 1', async () => {
    try {
      const db = (await import('../db/mongodb.js')).getDb()
      const workspaces = await db.collection('workspaces').find({ deleted_at: null }).toArray()

      const now = new Date()
      const weekAgo = new Date(now)
      weekAgo.setDate(weekAgo.getDate() - 7)
      const weekLabel = `${weekAgo.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

      for (const ws of workspaces) {
        try {
          const wid = ws._id.toString()

          // Gather budget/campaign stats
          const campaigns = await db.collection('ads_campaigns').find({ workspace_id: wid, deleted_at: null }).toArray()
          const totalBudget = campaigns.reduce((s, c) => s + (c.budget?.amount || 0), 0)
          const totalSpend = campaigns.reduce((s, c) => s + (c.metrics?.spend || 0), 0)
          const totalImpressions = campaigns.reduce((s, c) => s + (c.metrics?.impressions || 0), 0)
          const totalClicks = campaigns.reduce((s, c) => s + (c.metrics?.clicks || 0), 0)
          const totalConversions = campaigns.reduce((s, c) => s + (c.metrics?.conversions || 0), 0)
          const activeCampaigns = campaigns.filter(c => c.status === 'active').length

          // Posts stats for last 7 days
          const postsPublished = await db.collection('social_posts').countDocuments({
            workspace_id: wid,
            status: 2,
            published_at: { $gte: weekAgo },
          })
          const postsScheduled = await db.collection('social_posts').countDocuments({
            workspace_id: wid,
            status: 1,
          })

          const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : null
          const cpc = totalClicks > 0 ? totalSpend / totalClicks : null
          const cpa = totalConversions > 0 ? totalSpend / totalConversions : null

          // Get workspace member emails
          const memberIds = (ws.members || []).map(m => m.user_id)
          const { ObjectId } = await import('mongodb')
          const users = await db.collection('users').find({
            _id: { $in: memberIds.map(id => { try { return new ObjectId(id) } catch { return null } }).filter(Boolean) },
          }).toArray()
          const emails = users.map(u => u.email).filter(Boolean)
          if (!emails.length) continue

          await sendWeeklyReport({
            to: emails,
            workspaceName: ws.name || 'Your Workspace',
            weekLabel,
            stats: {
              total_budget: totalBudget,
              total_spend: totalSpend,
              budget_remaining: totalBudget - totalSpend,
              total_impressions: totalImpressions,
              total_clicks: totalClicks,
              ctr,
              cpc,
              total_conversions: totalConversions,
              cpa,
              active_campaigns: activeCampaigns,
              posts_published: postsPublished,
              posts_scheduled: postsScheduled,
            },
          })
        } catch (wsErr) {
          console.error(`[Scheduler] weekly-report: workspace ${ws._id} error:`, wsErr.message)
        }
      }
    } catch (err) {
      console.error('[Scheduler] weekly-report error:', err.message)
    }
  })

  // --- Every day at 6am UTC: auto-sync Google Ads campaigns & metrics ---
  cron.schedule('0 6 * * *', async () => {
    try {
      const db = (await import('../db/mongodb.js')).getDb()
      const gadsAccounts = await db.collection('accounts').find({
        provider: 'google_ads',
        authorized: true,
        deleted_at: { $exists: false },
      }).toArray()

      for (const account of gadsAccounts) {
        try {
          const { getSocialProvider } = await import('../providers/index.js')
          const provider = await getSocialProvider('google_ads', {}, account)
          const campaigns = await provider.syncCampaigns()
          const wid = account.workspace_id

          for (const rc of campaigns) {
            const filter = { workspace_id: wid, google_campaign_id: rc.google_campaign_id }
            const existing = await db.collection('ads_campaigns').findOne(filter)
            if (existing) {
              await db.collection('ads_campaigns').updateOne(filter, {
                $set: { name: rc.name, status: rc.status, budget: rc.budget, metrics: rc.metrics, updated_at: new Date() },
              })
            } else {
              const { nanoid } = await import('nanoid')
              await db.collection('ads_campaigns').insertOne({
                uuid: nanoid(), workspace_id: wid, google_campaign_id: rc.google_campaign_id,
                name: rc.name, platform: 'google_ads', type: rc.type, status: rc.status,
                budget: rc.budget, start_date: rc.start_date, end_date: rc.end_date,
                metrics: rc.metrics, keywords: [], targeting: {}, assets: {},
                deleted_at: null, created_at: new Date(), updated_at: new Date(),
              })
            }
          }
          console.log(`[Scheduler] google-ads-sync: synced ${campaigns.length} campaigns for workspace ${wid}`)
        } catch (err) {
          console.error(`[Scheduler] google-ads-sync: account ${account._id} error:`, err.message)
        }
      }
    } catch (err) {
      console.error('[Scheduler] google-ads-sync error:', err.message)
    }
  })

  console.log('[Scheduler] Started — 8 cron jobs active')
}
