import './bootstrap-env.js'
import SCServer from 'socketcluster-server'
import Redis from 'ioredis'
import http from 'http'

const PORT = parseInt(process.env.SC_PORT || '8000')
const EVENTS_CHANNEL = process.env.EVENTS_CHANNEL || 'agent_market:events'

function redisOptions() {
  const pw = process.env.REDIS_PASSWORD
  const password = pw != null && String(pw).trim() !== '' ? String(pw).trim() : undefined
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password,
  }
}

// Redis subscriber — relays the single events channel to all SC clients
const sub = new Redis(redisOptions())

const httpServer = http.createServer()
const agServer = new SCServer.AGServer({ httpServer })

;(async () => {
  for await (const { socket } of agServer.listener('connection')) {
    handleSocket(socket)
  }
})()

function handleSocket(socket) {
  console.log(`[Realtime] Client connected: ${socket.id}`)

  ;(async () => {
    for await (const {} of socket.listener('disconnect')) {
      console.log(`[Realtime] Client disconnected: ${socket.id}`)
    }
  })()
}

// Subscribe to the single EVENTS_CHANNEL and relay every message to SC channel 'events'
sub.subscribe(EVENTS_CHANNEL)
sub.on('message', (channel, message) => {
  let data
  try { data = JSON.parse(message) } catch { data = message }
  console.log(`[Realtime] Relay ${channel} →`, data?.event || data)
  // socketcluster-server v17+: transmitPublish (not legacy exchange.publish)
  if (typeof agServer.exchange.transmitPublish === 'function') {
    agServer.exchange.transmitPublish('events', data)
  } else if (typeof agServer.exchange.invokePublish === 'function') {
    agServer.exchange.invokePublish('events', data).catch((err) => {
      console.error('[Realtime] invokePublish failed', err)
    })
  } else {
    console.error('[Realtime] No publish method on exchange')
  }
})

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[Realtime] SocketCluster listening on port ${PORT}`)
  console.log(`[Realtime] Subscribed to Redis channel: ${EVENTS_CHANNEL}`)
})
