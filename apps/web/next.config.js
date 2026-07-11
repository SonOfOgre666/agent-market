import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Monorepo: API and start scripts use repo-root `.env`. Next only auto-loads `apps/web/.env*`,
// so load root here so `NEXT_PUBLIC_*` matches the rest of the stack.
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true })

// Root `.env` often sets NODE_ENV=production for the API. `next dev` must stay in development
// or Webpack mis-parses CSS (e.g. globals.css "@import" → "Unexpected character '@'") and pages 500.
const argv = process.argv.join(' ')
const isNextDev =
  process.env.npm_lifecycle_event === 'dev' ||
  /\bnext\s+dev\b/.test(argv) ||
  (argv.includes('next') && argv.includes('dev') && !argv.includes('build'))
if (isNextDev) {
  process.env.NODE_ENV = 'development'
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Dev: allow Try Cloudflare quick tunnels to load /_next/* from the browser (cross-origin).
  allowedDevOrigins: ['*.trycloudflare.com'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.twimg.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: '**.fbcdn.net' },
      { protocol: 'https', hostname: '**.cdninstagram.com' },
    ],
  },
  async redirects() {
    return [
      { source: '/teams', destination: '/team', permanent: false },
      { source: '/services', destination: '/integrations', permanent: true },
      { source: '/settings', destination: '/preferences', permanent: true },
      { source: '/ai', destination: '/ai-integrations', permanent: true },
      { source: '/ai-providers', destination: '/ai-integrations', permanent: true },
    ]
  },
  async rewrites() {
    // Prefer a URL the *Node/Next process* can reach. NEXT_PUBLIC_API_URL is often ngrok/Try Cloudflare
    // for the browser; proxying server→ngrok often returns 502. Local dev: http://127.0.0.1:4010;
    // Docker web build: http://api:4010 (see Dockerfile / compose build args).
    const apiBase = (
      process.env.NEXT_REWRITE_API_URL ||
      process.env.INTERNAL_API_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      'http://127.0.0.1:4010'
    ).replace(/\/$/, '')
    return [
      // Browsers request /favicon.ico by default; serve app logo (PNG) to avoid 404s in DevTools.
      { source: '/favicon.ico', destination: '/img/logo.png' },
      // Same-origin proxy for browser → API (avoids ngrok OPTIONS/CORS when NEXT_PUBLIC_API_URL is a tunnel).
      { source: '/__agentmarket_api/:path*', destination: `${apiBase}/api/:path*` },
    ]
  },
}

export default nextConfig
