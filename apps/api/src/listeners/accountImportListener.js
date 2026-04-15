/**
 * Mirrors Laravel's HandleAccountImports listener.
 * When a new account is connected (account_added event), immediately dispatch
 * import jobs for that account: followers + posts/insights + metrics.
 */
import { getRedisSub } from '../db/redis.js'
import { findById as findAccount } from '../models/Account.js'
import {
  dispatchImportTwitterFollowers,
  dispatchImportTwitterPosts,
  dispatchProcessTwitterMetrics,
  dispatchImportMastodonFollowers,
  dispatchImportMastodonPosts,
  dispatchProcessMastodonMetrics,
  dispatchImportFacebookFollowers,
  dispatchImportFacebookInsights,
  dispatchImportInstagramFollowers,
} from '../queue/dispatcher.js'

export function startAccountImportListener() {
  const sub = getRedisSub()
  sub.subscribe('agentmarket:account_added')

  sub.on('message', async (channel, message) => {
    if (channel !== 'agentmarket:account_added') return
    let payload
    try { payload = JSON.parse(message) } catch { return }

    const { account_id } = payload
    if (!account_id) return

    const account = await findAccount(account_id).catch(() => null)
    if (!account || !account.authorized) return

    const provider = account.provider
    try {
      if (provider === 'twitter') {
        await dispatchImportTwitterFollowers(account_id)
        await dispatchImportTwitterPosts(account_id)
        await dispatchProcessTwitterMetrics(account_id)
      } else if (provider === 'mastodon') {
        await dispatchImportMastodonFollowers(account_id)
        await dispatchImportMastodonPosts(account_id)
        await dispatchProcessMastodonMetrics(account_id)
      } else if (provider === 'facebook') {
        await dispatchImportFacebookFollowers(account_id)
        await dispatchImportFacebookInsights(account_id)
      } else if (provider === 'instagram') {
        await dispatchImportInstagramFollowers(account_id)
      }
      console.log(`[AccountImportListener] Queued import jobs for ${provider} account ${account_id}`)
    } catch (err) {
      console.error(`[AccountImportListener] Failed to dispatch for ${account_id}:`, err.message)
    }
  })
}
