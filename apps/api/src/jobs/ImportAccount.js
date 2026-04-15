import { findById as findAccount } from '../models/Account.js'
import { getSocialProvider } from '../providers/index.js'
import { upsertAudience } from '../models/Metric.js'
import { upsert as upsertImportedPost } from '../models/ImportedPost.js'

export async function importAccountJob({ account_id }) {
  const account = await findAccount(account_id)
  if (!account || !account.authorized) return

  try {
    const provider = await getSocialProvider(account.provider, {}, account)
    const today = new Date().toISOString().split('T')[0]

    // Import followers/audience
    if (typeof provider.getFollowers === 'function') {
      const total = await provider.getFollowers()
      if (total !== null && total !== undefined) {
        await upsertAudience(account_id, today, total)
      }
    }

    // Import posts (Twitter/Mastodon)
    if (typeof provider.getRecentPosts === 'function') {
      const posts = await provider.getRecentPosts()
      for (const post of posts) {
        await upsertImportedPost(account_id, post.provider_post_id, post.content, post.metrics)
      }
    }
  } catch (err) {
    console.error(`[ImportAccount] account ${account_id} failed:`, err.message)
    throw err
  }
}
