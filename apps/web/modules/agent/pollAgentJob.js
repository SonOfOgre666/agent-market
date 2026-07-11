import { api } from '../../lib/api.js'

const RATE_LIMIT_RE = /rate limit|retry in (\d+)/i

/**
 * Poll GET /agent/jobs/:id until complete. Handles API rate limits with backoff.
 * @returns {Promise<{ ok: boolean, data?: unknown, error?: string }>}
 */
export async function pollAgentJob(jobId, {
  maxWaitMs = 300000,
  intervalMs = 1200,
  onTick,
  shouldAbort,
} = {}) {
  const start = Date.now()
  let waitMs = intervalMs

  while (Date.now() - start < maxWaitMs) {
    if (shouldAbort?.()) {
      return { ok: false, aborted: true, error: 'Stopped by user.' }
    }

    try {
      const res = await api.agentJob(jobId)
      if (res?.status === 'complete') {
        return {
          ok: res.ok !== false,
          data: res.data,
          error: res.error || null,
        }
      }
      waitMs = intervalMs
    } catch (err) {
      const msg = err?.message || ''
      const match = msg.match(RATE_LIMIT_RE)
      if (match) {
        const sec = match[1] ? parseInt(match[1], 10) : 8
        waitMs = Math.max(sec * 1000, intervalMs)
        await new Promise(r => setTimeout(r, waitMs))
        continue
      }
      throw err
    }

    if (onTick) {
      try {
        await onTick()
      } catch {
        /* ignore refresh errors during poll */
      }
    }

    await new Promise(r => setTimeout(r, waitMs))
  }
  throw new Error('Planning is taking longer than usual — the worker may still be running. Refresh the page in a moment.')
}
