import { config } from 'dotenv'
config({ path: new URL('../../../.env', import.meta.url) })
import SCServer from 'socketcluster-server'
import Redis from 'ioredis'
import http from 'http'

const PORT = parseInt(process.env.SC_PORT || '8000')

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
}

// Redis subscriber — relays messages to SocketCluster clients
const sub = new Redis(redisConfig)

// Channels that the API publishes to
const RELAY_CHANNELS = [
  'agentmarket:post_published',
  'agentmarket:post_scheduled',
  'agentmarket:account_added',
  'agentmarket:account_unauthorized',
]

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
    for await (const { channel } of socket.listener('subscribe')) {
      // Only allow agentmarket:* channels
      if (!channel.startsWith('agentmarket:')) {
        socket.unsubscribe(channel)
      }
    }
  })()

  ;(async () => {
    for await (const {} of socket.listener('disconnect')) {
      console.log(`[Realtime] Client disconnected: ${socket.id}`)
    }
  })()
}

// Subscribe to Redis channels and relay to SC clients
sub.subscribe(...RELAY_CHANNELS)
sub.on('message', (channel, message) => {
  let data
  try { data = JSON.parse(message) } catch { data = message }
  console.log(`[Realtime] Relay ${channel}`, data)
  agServer.exchange.publish(channel, data)
})

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[Realtime] SocketCluster listening on port ${PORT}`)
})
