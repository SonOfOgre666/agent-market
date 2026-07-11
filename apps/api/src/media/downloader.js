import axios from 'axios'
import path from 'path'
import fs from 'fs/promises'
import { nanoid } from 'nanoid'
import { createMedia } from '../models/Media.js'
import { processMedia } from './processor.js'
import { getDecryptedConfig } from '../models/Integration.js'

const UPLOAD_DIR = process.env.STORAGE_LOCAL_PATH || './uploads'

/**
 * Mirrors TriggerDownloadJob — calls the Unsplash download endpoint to satisfy
 * API guidelines (counts the photo as a download in their stats).
 */
async function triggerUnsplashDownload(downloadLocation) {
  try {
    const config = await getDecryptedConfig('unsplash')
    if (!config.client_id && !config.access_key) return
    await axios.get(downloadLocation, {
      headers: { Authorization: `Client-ID ${config.client_id || config.access_key}` },
    })
  } catch (err) {
    console.error('[Unsplash] TriggerDownload failed:', err.message)
  }
}

export async function downloadExternalMedia(url, source, downloadLocation, workspace_id) {
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 })
  const contentType = response.headers['content-type'] || 'image/jpeg'
  const ext = contentType.split('/')[1]?.split(';')[0] || 'jpg'
  const filename = `${nanoid()}.${ext}`
  const dest = path.join(UPLOAD_DIR, filename)

  await fs.mkdir(UPLOAD_DIR, { recursive: true })
  await fs.writeFile(dest, Buffer.from(response.data))

  const stat = await fs.stat(dest)
  const originalName = url.split('/').pop()?.split('?')[0] || filename

  const media = await createMedia({
    workspace_id: workspace_id || null,
    name: originalName,
    mime_type: contentType.split(';')[0],
    disk: 'local',
    path: filename,
    size: stat.size,
  })

  processMedia(media).catch(console.error)

  // Mirrors TriggerDownloadJob: ping Unsplash download endpoint (API terms requirement)
  if (source === 'stock' && downloadLocation) {
    triggerUnsplashDownload(downloadLocation).catch(console.error)
  }

  return media
}
