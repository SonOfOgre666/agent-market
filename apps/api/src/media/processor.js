import sharp from 'sharp'
import ffmpeg from 'fluent-ffmpeg'
import path from 'path'
import fs from 'fs/promises'
import { updateConversions } from '../models/Media.js'

const UPLOAD_DIR = process.env.STORAGE_LOCAL_PATH || './uploads'

if (process.env.FFMPEG_PATH) ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH)
if (process.env.FFPROBE_PATH) ffmpeg.setFfprobePath(process.env.FFPROBE_PATH)

/**
 * Main entry: runs all applicable conversions.
 * Mirrors MediaImageResizeConversion + MediaVideoThumbConversion from Laravel.
 */
export async function processMedia(media) {
  const conversions = []
  const srcPath = path.join(UPLOAD_DIR, media.path)

  try {
    // --- Image resize (mirrors MediaImageResizeConversion) ---
    // canPerform(): isImage() && !isGifImage()
    if (media.mime_type.startsWith('image') && media.mime_type !== 'image/gif') {
      const thumbName = `thumb_${media.path}`
      const thumbPath = path.join(UPLOAD_DIR, thumbName)

      // Resize to width=430, preserve aspect ratio, never upscale
      // Mirrors: MediaImageResizeConversion::name('thumb')->width(430)
      await sharp(srcPath)
        .resize(430, null, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toFile(thumbPath)

      const stat = await fs.stat(thumbPath)
      conversions.push({ name: 'thumbnail', path: thumbName, mime_type: 'image/jpeg', size: stat.size })
    }

    // --- Video thumbnail (mirrors MediaVideoThumbConversion) ---
    // canPerform(): isVideo()
    if (media.mime_type.startsWith('video')) {
      const baseName = path.basename(media.path, path.extname(media.path))
      const thumbName = `thumb_${baseName}.jpg`
      const thumbPath = path.join(UPLOAD_DIR, thumbName)

      // Mirrors: MediaVideoThumbConversion::name('thumb')->atSecond(5)
      await generateVideoThumbnail(srcPath, thumbPath, 5)

      const stat = await fs.stat(thumbPath).catch(() => null)
      if (stat) conversions.push({ name: 'thumbnail', path: thumbName, mime_type: 'image/jpeg', size: stat.size })
    }
  } catch (err) {
    console.error(`[MediaProcessor] Failed for ${media.path}:`, err.message)
  }

  await updateConversions(media._id.toString(), conversions)
  return conversions
}

/**
 * Extract a frame from a video at atSecond.
 * Falls back to second=0 if the requested frame doesn't save — mirrors Laravel fallback.
 */
function generateVideoThumbnail(srcPath, destPath, atSecond = 0) {
  return new Promise((resolve, reject) => {
    ffmpeg(srcPath)
      .on('end', resolve)
      .on('error', async (err) => {
        if (atSecond !== 0) {
          // Fallback to first frame
          generateVideoThumbnail(srcPath, destPath, 0).then(resolve).catch(reject)
        } else {
          reject(err)
        }
      })
      .screenshots({
        count: 1,
        timemarks: [atSecond],
        filename: path.basename(destPath),
        folder: path.dirname(destPath),
        size: '400x?',
      })
  })
}

/**
 * Resize image to arbitrary width/height — used by callers that need custom sizes.
 * Mirrors MediaImageResizeConversion.width().height().handle()
 */
export async function resizeImage(srcPath, destPath, width = null, height = null) {
  await sharp(srcPath)
    .resize(width || undefined, height || undefined, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(destPath)
}
