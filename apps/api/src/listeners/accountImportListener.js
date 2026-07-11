/**
 * When a new account is connected, enqueue Celery ``tasks.imports.import_account``.
 */
import { getRedisSub } from '../lib/redis.js'
import { findById as findAccount } from '../models/Account.js'
import { dispatchImportAccount } from '../queue/dispatcher.js'

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

    try {
      const out = await dispatchImportAccount(account_id)
      console.log(
        `[AccountImportListener] Queued tasks.imports.import_account bridge_task_id=${out.task_id} for ${account_id}`,
      )
    } catch (err) {
      console.error(`[AccountImportListener] Failed to enqueue for ${account_id}:`, err.message)
    }
  })
}
