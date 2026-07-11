import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCHEMA_DIR = join(__dirname, '../../../../services/ai-worker/schemas/ads')

const PLATFORM_FILES = {
  meta_ads: 'meta_ads_workflow.json',
  google_ads: 'google_ads_workflow.json',
}

export function getAdsWorkflowSchema(platform) {
  const key = String(platform || '').trim()
  const file = PLATFORM_FILES[key]
  if (!file) return null
  try {
    const raw = readFileSync(join(SCHEMA_DIR, file), 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function listAdsWorkflowPlatforms() {
  return Object.keys(PLATFORM_FILES)
}
