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

export function getMediaPreviewUrl(item) {
  if (!item) return ''

  const thumbNamed = (item.conversions || []).find((c) => c.name === 'thumbnail' && c.url)?.url
  const thumbAny = (item.conversions || []).find((c) => c?.url)?.url
  const pathUrl = item.path ? `/uploads/${item.path}` : ''

  const resolved = normalizeMediaUrl(
    item.thumb ||
      item.preview ||
      item.small ||
      thumbNamed ||
      thumbAny ||
      item.url ||
      item.download_url ||
      pathUrl ||
      '',
  )
  return toPreviewSrc(resolved)
}
