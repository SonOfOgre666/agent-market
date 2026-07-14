'use client'
import { create } from 'socketcluster-client'

let socket = null

function isLocalHost(hostname) {
  const h = (hostname || '').trim()
  return (
    !h ||
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '[::1]' ||
    h.endsWith('.localhost')
  )
}

function isTunnelHost(hostname) {
  const h = (hostname || '').trim().toLowerCase()
  return h.endsWith('.trycloudflare.com') || h.endsWith('.cfargotunnel.com') || h.endsWith('.ngrok-free.dev') || h.endsWith('.ngrok.io')
}

/**
 * Public tunnels terminate TLS on 443 and forward to local :8000.
 * Browsers also block ws:// from HTTPS pages (mixed content).
 */
function resolveSocketSecure(hostname) {
  if (typeof window !== 'undefined' && window.location?.protocol === 'https:') return true
  if (isTunnelHost(hostname)) return true
  if (process.env.NEXT_PUBLIC_SC_SECURE === 'true') return true
  if (process.env.NEXT_PUBLIC_SC_SECURE === 'false') return false
  if (isLocalHost(hostname)) return false
  return process.env.NODE_ENV === 'production'
}

function resolveSocketPort(hostname, secure) {
  const raw = process.env.NEXT_PUBLIC_SC_PORT
  const configured = raw != null && String(raw).trim() !== '' ? parseInt(String(raw), 10) : NaN
  // Cloudflare / ngrok tunnels: never dial :8000 on the public hostname.
  if (isTunnelHost(hostname) || (secure && !isLocalHost(hostname))) {
    if (!Number.isFinite(configured) || configured === 8000) return secure ? 443 : 80
  }
  if (Number.isFinite(configured)) return configured
  return secure ? 443 : 8000
}

export function getSocket() {
  if (socket) return socket
  const hostname = process.env.NEXT_PUBLIC_SC_HOST || 'localhost'
  const secure = resolveSocketSecure(hostname)
  const port = resolveSocketPort(hostname, secure)
  socket = create({
    hostname,
    port,
    secure,
    autoReconnect: true,
    autoReconnectOptions: { initialDelay: 1000, maxDelay: 10000 },
  })
  return socket
}

export function subscribe(channel, handler) {
  const sc = getSocket()
  const ch = sc.subscribe(channel)
  ;(async () => {
    for await (const data of ch) {
      handler(data)
    }
  })()
  return () => sc.unsubscribe(channel)
}
