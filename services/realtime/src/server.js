import { config } from 'dotenv'
config({ path: new URL('../../../.env', import.meta.url) })
import SCServer from 'socketcluster-server'
import Redis from 'ioredis'
import http from 'http'

const PORT = parseInt(process.env.SC_PORT || '8000')
const EVENTS_CHANNEL = process.env.EVENTS_CHANNEL || 'agent_market:events'

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
}

// Redis subscriber — relays the single events channel to all SC clients
const sub = new Redis(redisConfig)

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
  agServer.exchange.publish('events', data)
})

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[Realtime] SocketCluster listening on port ${PORT}`)
  console.log(`[Realtime] Subscribed to Redis channel: ${EVENTS_CHANNEL}`)
})
