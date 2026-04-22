#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Agent Market — startup script
# Run after every PC boot: ./start.sh
# ─────────────────────────────────────────────────────────────
set -e
cd "$(dirname "$0")"

NGROK_DOMAIN="chelsie-unsignalised-noncommendably.ngrok-free.dev"
ENV_FILE=".env"

log() { echo -e "\033[1;36m[start]\033[0m $*"; }
ok()  { echo -e "\033[1;32m[ok]\033[0m $*"; }
err() { echo -e "\033[1;31m[err]\033[0m $*"; }

# ── 1. Start Docker services ─────────────────────────────────
log "Starting Docker containers..."
docker compose up -d
ok "Docker: api:4010  web:3000  realtime:8000  redis:6379"

# ── 2. Kill any stale tunnels ────────────────────────────────
pkill -f "ngrok" 2>/dev/null || true
pkill -f "cloudflared tunnel" 2>/dev/null || true
sleep 1

# ── 3. Start ngrok → API (static URL, never changes) ────────
log "Starting ngrok → localhost:4010"
nohup ngrok http --url="$NGROK_DOMAIN" 4010 > /tmp/ngrok-api.log 2>&1 &
NGROK_PID=$!

# ── 4. Start cloudflare → Web (port 3000) ───────────────────
log "Starting cloudflared → localhost:3000 (web)..."
nohup cloudflared tunnel --url http://localhost:3000 > /tmp/cf-web.log 2>&1 &
CF_WEB_PID=$!

# ── 5. Start cloudflare → Realtime (port 8000) ──────────────
log "Starting cloudflared → localhost:8000 (realtime)..."
nohup cloudflared tunnel --url http://localhost:8000 > /tmp/cf-rt.log 2>&1 &
CF_RT_PID=$!

# ── 6. Wait for tunnel URLs to appear ───────────────────────
log "Waiting for tunnel URLs..."

# Real tunnel URLs always have hyphens (e.g. oils-cooperative-hours-lie.trycloudflare.com)
# The error URL "api.trycloudflare.com" has no hyphens — exclude it with the pattern below
get_cf_url() {
  local logfile="$1"
  local port="$2"
  local url=""
  for attempt in 1 2 3; do
    for i in $(seq 1 20); do
      # Require at least one hyphen in subdomain to exclude "api.trycloudflare.com"
      url=$(grep -oP 'https://[a-z0-9]+-[a-z0-9-]+\.trycloudflare\.com' "$logfile" 2>/dev/null | head -1)
      [ -n "$url" ] && echo "$url" && return
      # Check for failure and restart tunnel
      if grep -q "context deadline exceeded\|failed to request" "$logfile" 2>/dev/null; then
        break
      fi
      sleep 1
    done
    if [ -z "$url" ]; then
      log "Cloudflare attempt $attempt failed, retrying tunnel on port $port..."
      pkill -f "cloudflared tunnel --url http://localhost:${port}" 2>/dev/null || true
      sleep 1
      > "$logfile"
      nohup cloudflared tunnel --url "http://localhost:${port}" >> "$logfile" 2>&1 &
      sleep 2
    fi
  done
  echo ""
}

CF_WEB_URL=$(get_cf_url /tmp/cf-web.log 3000)
CF_RT_URL=$(get_cf_url /tmp/cf-rt.log 8000)

if [ -z "$CF_WEB_URL" ]; then
  err "Could not detect web cloudflare URL after 3 attempts — check /tmp/cf-web.log"
  exit 1
fi
if [ -z "$CF_RT_URL" ]; then
  err "Could not detect realtime cloudflare URL after 3 attempts — check /tmp/cf-rt.log"
  exit 1
fi

# Extract just the hostname from the realtime URL (no https://)
CF_RT_HOST=$(echo "$CF_RT_URL" | sed 's|https://||')

# ── 7. Update .env with new cloudflare URLs ──────────────────
OLD_WEB_URL=$(grep "^NEXT_PUBLIC_WEB_URL=" "$ENV_FILE" | cut -d= -f2-)
OLD_SC_HOST=$(grep "^NEXT_PUBLIC_SC_HOST=" "$ENV_FILE" | cut -d= -f2-)

sed -i "s|^NEXT_PUBLIC_WEB_URL=.*|NEXT_PUBLIC_WEB_URL=${CF_WEB_URL}|" "$ENV_FILE"
sed -i "s|^NEXT_PUBLIC_SC_HOST=.*|NEXT_PUBLIC_SC_HOST=${CF_RT_HOST}|" "$ENV_FILE"

ok ".env updated:"
ok "  NEXT_PUBLIC_WEB_URL=${CF_WEB_URL}"
ok "  NEXT_PUBLIC_SC_HOST=${CF_RT_HOST}"

# ── 8. Rebuild web container if SC_HOST changed ──────────────
if [ "$OLD_SC_HOST" != "$CF_RT_HOST" ]; then
  log "Realtime URL changed ($OLD_SC_HOST → $CF_RT_HOST) — rebuilding web container..."
  docker compose build web
  docker compose up -d web
  ok "Web container rebuilt with new realtime URL"
else
  ok "Realtime URL unchanged — no web rebuild needed"
fi

# ── 9. Verify ngrok is up ────────────────────────────────────
sleep 2
NGROK_STATUS=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | python3 -c \
  "import sys,json; t=json.load(sys.stdin).get('tunnels',[]); print(t[0]['public_url'] if t else 'not ready')" 2>/dev/null)

# ── 10. Final summary ────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ok "Agent Market is running"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  API       https://${NGROK_DOMAIN}"
echo "  Health    https://${NGROK_DOMAIN}/api/health"
echo "  Web       ${CF_WEB_URL}"
echo "  Realtime  wss://${CF_RT_HOST}"
echo ""
echo "  Docker containers:"
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
echo ""
echo "  Logs:  docker compose logs -f api"
echo "  Stop:  docker compose down && pkill -f 'ngrok|cloudflared tunnel'"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
