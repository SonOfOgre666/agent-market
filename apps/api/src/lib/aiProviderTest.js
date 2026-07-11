import * as Integration from '../models/Integration.js'
import { getAiProviderApiKey } from './aiProviderConfig.js'

/**
 * @returns {Promise<Array<{id: string, label: string, name: string}>|null>}
 */
export async function fetchOllamaTags(baseUrl) {
  const root = String(baseUrl || '').trim().replace(/\/$/, '')
  if (!root) return null
  try {
    const res = await fetch(`${root}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    const data = await res.json()
    return (data.models || [])
      .map(m => {
        const name = String(m.name || m.model || '').trim()
        return name ? { id: name, label: name, name } : null
      })
      .filter(Boolean)
  } catch {
    return null
  }
}

/**
 * @returns {Promise<'connected'|'invalid_key'>}
 */
export async function testProviderConnection(provider, workspace_id, opts = {}) {
  if (provider === 'ollama') {
    const cfg = await Integration.getDecryptedConfig('ollama', workspace_id)
    const baseUrl = (opts.base_url || cfg.base_url || '').trim()
    if (!baseUrl) return 'invalid_key'
    const models = await fetchOllamaTags(baseUrl)
    return models?.length ? 'connected' : 'invalid_key'
  }

  const apiKey = await getAiProviderApiKey(provider, workspace_id)
  if (!apiKey) return 'invalid_key'

  try {
    if (provider === 'gemini') {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
        { method: 'GET', signal: AbortSignal.timeout(15000) },
      )
      if (res.ok) return 'connected'
      return 'invalid_key'
    }

    if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15000),
      })
      if (res.ok) return 'connected'
      return 'invalid_key'
    }

    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-20250514',
          max_tokens: 8,
          messages: [{ role: 'user', content: 'ping' }],
        }),
        signal: AbortSignal.timeout(20000),
      })
      if (res.ok) return 'connected'
      const status = res.status
      if (status === 401 || status === 403) return 'invalid_key'
      if (status >= 400 && status < 500) return 'invalid_key'
      return 'connected'
    }

    if (provider === 'openrouter') {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15000),
      })
      if (res.ok) return 'connected'
      return 'invalid_key'
    }
  } catch {
    return 'invalid_key'
  }

  return 'invalid_key'
}

/** Refresh stored Ollama model list after a successful connection test. */
export async function refreshOllamaModels(workspace_id, baseUrl) {
  const models = await fetchOllamaTags(baseUrl)
  if (!models?.length) return null
  const cfg = await Integration.getDecryptedConfig('ollama', workspace_id)
  await Integration.upsertIntegration(
    'ollama',
    { ...cfg, base_url: baseUrl, models },
    workspace_id,
  )
  return models
}

export function providerStatusFromKey(hasKey, lastTestStatus) {
  if (!hasKey) return 'not_configured'
  if (lastTestStatus === 'connected') return 'connected'
  if (lastTestStatus === 'invalid_key') return 'invalid_key'
  return 'not_configured'
}
