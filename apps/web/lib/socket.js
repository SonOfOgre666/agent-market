'use client'
import { create } from 'socketcluster-client'

let socket = null

export function getSocket() {
  if (socket) return socket
  socket = create({
    hostname: process.env.NEXT_PUBLIC_SC_HOST || 'localhost',
    port: parseInt(process.env.NEXT_PUBLIC_SC_PORT || '8000'),
    secure: process.env.NODE_ENV === 'production',
    autoReconnect: true,
    autoReconnectOptions: { initialDelay: 1000, maxDelay: 10000 },
  })
  return socket
}

export async function subscribe(channel, handler) {
  const sc = getSocket()
  const ch = sc.subscribe(channel)
  ;(async () => {
    for await (const data of ch) {
      handler(data)
    }
  })()
  return () => sc.unsubscribe(channel)
}
