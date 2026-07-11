import * as Integration from '../models/Integration.js'

async function loadConfig(name, workspace_id) {
  let cfg = await Integration.getDecryptedConfig(name, workspace_id)
  if ((!cfg || !Object.keys(cfg).length) && workspace_id) {
    cfg = await Integration.getDecryptedConfig(name, null)
  }
  return cfg || {}
}

/**
 * Resolve API key from integrations DB only (workspace row, then global row).
 * Configure keys under Settings → AI; .env AI keys are not used.
 */
export async function getAiProviderApiKey(name, workspace_id = null) {
  const cfg = await loadConfig(name, workspace_id)
  return (cfg.api_key || '').trim()
}

/** Alias used by AI feature runtime (matches worker naming). */
export const resolveApiKey = getAiProviderApiKey

export async function isGeminiConfigured(workspace_id = null) {
  return Boolean(await getAiProviderApiKey('gemini', workspace_id))
}

export async function isOpenAiConfigured(workspace_id = null) {
  return Boolean(await getAiProviderApiKey('openai', workspace_id))
}

export async function isAnthropicConfigured(workspace_id = null) {
  return Boolean(await getAiProviderApiKey('anthropic', workspace_id))
}

export async function isOpenRouterConfigured(workspace_id = null) {
  return Boolean(await getAiProviderApiKey('openrouter', workspace_id))
}

export async function getOllamaBaseUrl(workspace_id = null) {
  const cfg = await loadConfig('ollama', workspace_id)
  return (cfg.base_url || '').trim()
}

export async function isOllamaConfigured(workspace_id = null) {
  return Boolean(await getOllamaBaseUrl(workspace_id))
}
