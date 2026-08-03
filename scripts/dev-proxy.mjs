#!/usr/bin/env node
/**
 * Local reverse proxy: one public origin (ngrok) → web / API / realtime.
 *   /api/media-proxy                     → :3000 (Next.js route)
 *   /api, /uploads, /callback, Meta…     → :4010
 *   /socketcluster/* (+ WS)              → :8000
 *   everything else (+ Next HMR WS)      → :3000
 */
import http from 'node:http'
import { URL } from 'node:url'

const LISTEN_HOST = process.env.DEV_PROXY_HOST || '127.0.0.1'
const LISTEN_PORT = parseInt(process.env.DEV_PROXY_PORT || '8080', 10)
const WEB = process.env.DEV_PROXY_WEB || 'http://127.0.0.1:3000'
const API = process.env.DEV_PROXY_API || 'http://127.0.0.1:4010'
const RT = process.env.DEV_PROXY_RT || 'http://127.0.0.1:8000'

function parseTarget(base) {
  const u = new URL(base)
  return { hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80) }
}

const TARGETS = {
  web: parseTarget(WEB),
  api: parseTarget(API),
  rt: parseTarget(RT),
}

function pickTarget(pathname) {
  // Next.js App Router — must not be forwarded to the Fastify API
  if (pathname === '/api/media-proxy' || pathname.startsWith('/api/media-proxy/')) {
    return { name: 'web', ...TARGETS.web }
  }
  if (
    pathname === '/api' ||
    pathname.startsWith('/api/') ||
    pathname === '/uploads' ||
    pathname.startsWith('/uploads/') ||
    pathname === '/callback' ||
    pathname.startsWith('/callback/') ||
    pathname === '/data-deletion' ||
    pathname.startsWith('/data-deletion/') ||
    pathname === '/privacy' ||
    pathname === '/terms' ||
    pathname === '/deauthorize' ||
    pathname.endsWith('.txt') && pathname.includes('tiktok')
  ) {
    return { name: 'api', ...TARGETS.api }
  }
  if (pathname === '/socketcluster' || pathname.startsWith('/socketcluster/')) {
    return { name: 'rt', ...TARGETS.rt }
  }
  return { name: 'web', ...TARGETS.web }
}

function copyHeaders(req) {
  const headers = { ...req.headers }
  // Avoid broken hop-by-hop / compressed double-decode issues
  delete headers['host']
  delete headers['connection']
  delete headers['keep-alive']
  delete headers['proxy-connection']
  delete headers['transfer-encoding']
  delete headers['upgrade']
  return headers
}

function proxyHttp(req, res, target) {
  const headers = copyHeaders(req)
  headers.host = `${target.hostname}:${target.port}`
  headers['x-forwarded-host'] = req.headers.host || ''
  headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] || 'https'
  headers['x-forwarded-for'] = req.socket.remoteAddress || ''

  const upstream = http.request(
    {
      hostname: target.hostname,
      port: target.port,
      path: req.url,
      method: req.method,
      headers,
    },
    (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers)
      upRes.pipe(res)
    },
  )
  upstream.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain' })
    }
    res.end(`Bad gateway (${target.name}): ${err.message}`)
  })
  req.pipe(upstream)
}

function proxyWs(req, socket, head, target) {
  const headers = { ...req.headers }
  headers.host = `${target.hostname}:${target.port}`
  headers['x-forwarded-host'] = req.headers.host || ''
  headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] || 'https'

  const upstream = http.request({
    hostname: target.hostname,
    port: target.port,
    path: req.url,
    method: req.method,
    headers,
  })

  upstream.on('upgrade', (upRes, upSocket, upHead) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
        Object.entries(upRes.headers)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
          .join('\r\n') +
        '\r\n\r\n',
    )
    if (upHead?.length) socket.write(upHead)
    upSocket.pipe(socket)
    socket.pipe(upSocket)
    upSocket.on('error', () => socket.destroy())
    socket.on('error', () => upSocket.destroy())
  })

  upstream.on('error', (err) => {
    console.error(`[dev-proxy] WS → ${target.name} failed:`, err.message)
    socket.destroy()
  })

  upstream.on('response', (upRes) => {
    // Upstream refused upgrade
    socket.write(`HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage || ''}\r\n\r\n`)
    upRes.pipe(socket)
  })

  if (head?.length) upstream.write(head)
  upstream.end()
}

const server = http.createServer((req, res) => {
  let pathname = '/'
  try {
    pathname = new URL(req.url || '/', 'http://localhost').pathname
  } catch {
    /* keep / */
  }
  const target = pickTarget(pathname)
  proxyHttp(req, res, target)
})

server.on('upgrade', (req, socket, head) => {
  let pathname = '/'
  try {
    pathname = new URL(req.url || '/', 'http://localhost').pathname
  } catch {
    /* keep / */
  }
  const target = pickTarget(pathname)
  proxyWs(req, socket, head, target)
})

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(
    `[dev-proxy] http://${LISTEN_HOST}:${LISTEN_PORT} → web ${WEB} | api ${API} | rt ${RT}`,
  )
})
