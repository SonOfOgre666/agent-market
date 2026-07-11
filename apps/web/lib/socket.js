'use client'
import { create } from 'socketcluster-client'

let socket = null

function resolveSocketSecure(hostname) {
  const h = (hostname || '').trim()
  const local =
    !h ||
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '[::1]' ||
    h.endsWith('.localhost')
  if (process.env.NEXT_PUBLIC_SC_SECURE === 'true') return true
  if (process.env.NEXT_PUBLIC_SC_SECURE === 'false') return false
  // HTTPS pages cannot open ws:// (mixed content). Applies to dev tunnels (e.g. trycloudflare) too.
  if (typeof window !== 'undefined' && window.location?.protocol === 'https:') return true
  // Docker / prod builds often use NODE_ENV=production while the browser still talks to
  // plain ws on localhost — default wss only for non-local hosts in production.
  if (local) return false
  return process.env.NODE_ENV === 'production'
}

export function getSocket() {
  if (socket) return socket
  const hostname = process.env.NEXT_PUBLIC_SC_HOST || 'localhost'
  socket = create({
    hostname,
    port: parseInt(process.env.NEXT_PUBLIC_SC_PORT || '8000'),
    secure: resolveSocketSecure(hostname),
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
