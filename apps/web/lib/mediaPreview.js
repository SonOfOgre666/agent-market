/**
 * Resolve browser-safe preview URLs for media library / picker items.
 * Uploads use API /uploads URLs (often ngrok); proxy via /api/media-proxy when needed.
 */

const API_PUBLIC_BASE = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '')

function isNgrokHost(hostname = '') {
  const host = String(hostname).toLowerCase()
  return host.endsWith('ngrok-free.dev') || host.endsWith('ngrok.io') || host.endsWith('ngrok.app')
}

function isTunnelHost(hostname = '') {
  const host = String(hostname).toLowerCase()
  return (
    isNgrokHost(host) ||
    host.endsWith('trycloudflare.com') ||
    (host.endsWith('cloudflare.com') && host.includes('trycloudflare'))
  )
}

export function normalizeMediaUrl(rawUrl) {
  if (!rawUrl) return ''
  if (rawUrl.startsWith('data:')) return rawUrl

  if (rawUrl.startsWith('/')) {
    return API_PUBLIC_BASE ? `${API_PUBLIC_BASE}${rawUrl}` : rawUrl
  }

  try {
    const parsed = new URL(rawUrl)
    if (API_PUBLIC_BASE && ['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname)) {
      const apiBase = new URL(API_PUBLIC_BASE)
      return `${apiBase.origin}${parsed.pathname}${parsed.search}`
    }
    return rawUrl
  } catch {
    if (API_PUBLIC_BASE) return `${API_PUBLIC_BASE}/${String(rawUrl).replace(/^\/+/, '')}`
    return rawUrl
  }
}

/** Same-origin proxy so ngrok / cross-origin API uploads render in &lt;img&gt;. */
export function toPreviewSrc(url) {
  if (!url || url.startsWith('data:')) return url

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return url
  }

  const needsProxy =
    isNgrokHost(parsed.hostname) ||
    isTunnelHost(parsed.hostname) ||
    (typeof window !== 'undefined' &&
      API_PUBLIC_BASE &&
      (() => {
        try {
          return new URL(API_PUBLIC_BASE).origin !== window.location.origin &&
            parsed.origin === new URL(API_PUBLIC_BASE).origin
        } catch {
          return false
        }
      })())

  if (needsProxy) {
    return `/api/media-proxy?url=${encodeURIComponent(url)}`
  }
  return url
}

function conversionUrl(item, name) {
  return (item.conversions || []).find((c) => c.name === name && c.url)?.url || ''
}

function firstConversionUrl(item) {
  return (item.conversions || []).find((c) => c?.url)?.url || ''
}

function looksLikeImageUrl(url = '') {
  return /\.(jpe?g|png|gif|webp|avif|bmp)(\?|#|$)/i.test(String(url))
}

/** Actual media file URL (never a thumbnail). Use for &lt;video src&gt; / downloads. */
export function getMediaSourceUrl(item) {
  if (!item) return ''
  const pathUrl = item.path ? `/uploads/${item.path}` : ''
  const resolved = normalizeMediaUrl(
    item.url ||
    item.download_url ||
    pathUrl ||
    '',
  )
  return toPreviewSrc(resolved)
}

/** Still image preview / video poster (prefers thumbnail conversions). */
export function getMediaThumbnailUrl(item) {
  if (!item) return ''
  const thumbNamed = conversionUrl(item, 'thumbnail')
  const candidate = normalizeMediaUrl(
    item.thumb ||
    item.preview ||
    item.small ||
    thumbNamed ||
    firstConversionUrl(item) ||
    '',
  )
  if (!candidate) return ''
  // Don't feed a video file URL into poster/img when we only had conversions of wrong type
  if (item.mime_type?.startsWith('video/') && !looksLikeImageUrl(candidate) && !thumbNamed && !item.thumb) {
    return ''
  }
  return toPreviewSrc(candidate)
}

/**
 * Best URL for &lt;img&gt; previews.
 * For videos, prefers the thumbnail still; falls back to the video file only if no thumb exists.
 */
export function getMediaPreviewUrl(item) {
  if (!item) return ''
  if (item.mime_type?.startsWith('video/')) {
    return getMediaThumbnailUrl(item) || getMediaSourceUrl(item)
  }

  const pathUrl = item.path ? `/uploads/${item.path}` : ''
  const resolved = normalizeMediaUrl(
    item.thumb ||
      item.preview ||
      item.small ||
      conversionUrl(item, 'thumbnail') ||
      firstConversionUrl(item) ||
      item.url ||
      item.download_url ||
      pathUrl ||
      '',
  )
  return toPreviewSrc(resolved)
}
