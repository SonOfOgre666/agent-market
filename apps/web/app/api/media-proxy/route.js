export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isNgrokHost(hostname = '') {
  const host = hostname.toLowerCase()
  return host.endsWith('ngrok-free.dev') || host.endsWith('ngrok.io') || host.endsWith('ngrok.app')
}

function getAllowedApiHost() {
  const raw = process.env.NEXT_PUBLIC_API_URL || ''
  if (!raw) return null
  try {
    return new URL(raw).host
  } catch {
    return null
  }
}

function getInternalApiBase() {
  return (
    process.env.NEXT_REWRITE_API_URL ||
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://127.0.0.1:4010'
  ).replace(/\/$/, '')
}

/** Browser-facing API host may be localhost; server-side fetch must use the Docker/internal URL. */
function toUpstreamUrl(target) {
  const publicRaw = process.env.NEXT_PUBLIC_API_URL || ''
  if (!publicRaw) return target.toString()

  try {
    const publicBase = new URL(publicRaw)
    if (target.host !== publicBase.host) return target.toString()

    const internal = new URL(getInternalApiBase())
    target.protocol = internal.protocol
    target.hostname = internal.hostname
    target.port = internal.port
    return target.toString()
  } catch {
    return target.toString()
  }
}

export async function GET(request) {
  const requestUrl = new URL(request.url)
  const rawTarget = requestUrl.searchParams.get('url')

  if (!rawTarget) {
    return Response.json({ error: 'Missing url parameter' }, { status: 400 })
  }

  let target
  try {
    target = new URL(rawTarget)
  } catch {
    return Response.json({ error: 'Invalid url parameter' }, { status: 400 })
  }

  if (!['http:', 'https:'].includes(target.protocol)) {
    return Response.json({ error: 'Only http(s) URLs are allowed' }, { status: 400 })
  }

  const allowedHost = getAllowedApiHost()
  if (allowedHost) {
    if (target.host !== allowedHost) {
      return Response.json({ error: 'Forbidden host' }, { status: 403 })
    }
  } else if (!isNgrokHost(target.hostname)) {
    return Response.json({ error: 'Forbidden host' }, { status: 403 })
  }

  const upstreamHeaders = new Headers()
  const range = request.headers.get('range')
  if (range) upstreamHeaders.set('range', range)

  if (isNgrokHost(target.hostname)) {
    upstreamHeaders.set('ngrok-skip-browser-warning', 'true')
  }

  let upstream
  try {
    upstream = await fetch(toUpstreamUrl(target), {
      method: 'GET',
      headers: upstreamHeaders,
      cache: 'no-store',
      redirect: 'follow',
    })
  } catch {
    return Response.json({ error: 'Failed to reach upstream media URL' }, { status: 502 })
  }

  if (!upstream.ok && upstream.status !== 206) {
    return Response.json({ error: `Upstream returned ${upstream.status}` }, { status: 502 })
  }

  const headers = new Headers()
  ;[
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
    'cache-control',
    'etag',
    'last-modified',
  ].forEach((name) => {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  })

  if (!headers.has('cache-control')) {
    headers.set('cache-control', 'public, max-age=120')
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  })
}
