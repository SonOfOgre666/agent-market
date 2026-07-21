#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Agent Market — local startup (no Docker for app stack)
# Redis: checks local port when REDIS_HOST is localhost; otherwise skips.
# If local Redis is down and Docker is available, runs: docker compose up -d redis
# MongoDB: local :27017 only when MONGODB_URI points at this machine; Atlas skips.
# Starts: local reverse proxy + ngrok (one public origin), API + web + realtime (npm),
# Celery worker + beat (ai-worker). No Cloudflare tunnels.
# Prerequisite: Redis reachable (e.g. docker compose up -d redis) and Mongo (e.g. Atlas in .env).
# ─────────────────────────────────────────────────────────────
set -e
cd "$(dirname "$0")"

NGROK_DOMAIN="chelsie-unsignalised-noncommendably.ngrok-free.dev"
NGROK_PUBLIC_URL="https://${NGROK_DOMAIN}"
PROXY_PORT=8080
ENV_FILE=".env"
DEV_LOG="/tmp/agent-market-dev.log"
DEV_PID_FILE="/tmp/agent-market-dev.pid"
PROXY_LOG="/tmp/agent-market-proxy.log"
PROXY_PID_FILE="/tmp/agent-market-proxy.pid"
CELERY_WORKER_LOG="/tmp/agent-market-celery-worker.log"
CELERY_BEAT_LOG="/tmp/agent-market-celery-beat.log"
CELERY_WORKER_PID_FILE="/tmp/agent-market-celery-worker.pid"
CELERY_BEAT_PID_FILE="/tmp/agent-market-celery-beat.pid"

log() { echo -e "\033[1;36m[start]\033[0m $*" >&2; }
ok()  { echo -e "\033[1;32m[ok]\033[0m $*" >&2; }
err() { echo -e "\033[1;31m[err]\033[0m $*" >&2; }

# Update KEY=VALUE in .env without sed delimiter issues (URLs, secrets, /, &, etc.).
set_env_var() {
  local key="$1" value="$2"
  python3 - "$ENV_FILE" "$key" "$value" <<'PY'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
line_re = re.compile(rf"^{re.escape(key)}=.*$", re.M)
text = path.read_text(encoding="utf-8")
new_line = f"{key}={value}"
if line_re.search(text):
    text = line_re.sub(new_line, text, count=1)
else:
    if text and not text.endswith("\n"):
        text += "\n"
    text += new_line + "\n"
path.write_text(text, encoding="utf-8")
PY
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { err "Missing command: $1"; exit 1; }
}

port_listen() {
  local host="127.0.0.1" port="$1"
  if command -v nc >/dev/null 2>&1; then
    nc -z "$host" "$port" 2>/dev/null
  else
    timeout 1 bash -c "echo >/dev/tcp/${host}/${port}" 2>/dev/null
  fi
}

# True when MONGODB_URI points at this machine (mongod on 27017).
mongod_uri_expects_local() {
  local uri="$1"
  [ -z "$uri" ] && return 1
  [[ "$uri" == mongodb+srv://* ]] && return 1
  [[ "$uri" == *localhost* || "$uri" == *127.0.0.1* ]] && return 0
  return 1
}

# True when REDIS_HOST is unset or localhost (app expects TCP on REDIS_PORT).
redis_expects_local() {
  local host="$1"
  [ -z "$host" ] && return 0
  [[ "$host" == localhost || "$host" == 127.0.0.1 ]] && return 0
  return 1
}

try_start_redis_docker() {
  command -v docker >/dev/null 2>&1 || return 1
  docker compose version >/dev/null 2>&1 || return 1
  log "Redis not listening — starting redis via Docker (docker compose up -d redis)..."
  docker compose up -d redis || return 1
  local p="${1:-6379}"
  for _ in $(seq 1 35); do
    port_listen "$p" && return 0
    sleep 1
  done
  return 1
}

# Wait until local origins respond (avoids ngrok 502 right after script exits).
wait_for_origin_http() {
  local url=$1 label=$2 max_sec=${3:-180}
  local i
  log "Waiting for ${label} (first start can take 1–2 minutes)..."
  for i in $(seq 1 "$max_sec"); do
    # Any HTTP response counts (connection refused / timeout = failure). Avoid -f so 404/redirect still counts as "up".
    if curl -s -o /dev/null --max-time 3 "$url" 2>/dev/null; then
      ok "${label} is responding"
      return 0
    fi
    sleep 1
  done
  err "${label} did not respond within ${max_sec}s — check: tail -f $DEV_LOG"
  return 1
}

wait_for_origin_tcp() {
  local port=$1 label=$2 max_sec=${3:-120}
  local i
  log "Waiting for ${label} (TCP :${port})..."
  for i in $(seq 1 "$max_sec"); do
    if port_listen "$port"; then
      ok "${label} is listening"
      return 0
    fi
    sleep 1
  done
  err "${label} not listening on :${port} within ${max_sec}s — check: tail -f $DEV_LOG"
  return 1
}

# ── 0. Stop previous Celery + local dev + proxy (same script) ─────────
for PF in "$CELERY_WORKER_PID_FILE" "$CELERY_BEAT_PID_FILE" "$PROXY_PID_FILE"; do
  if [ -f "$PF" ]; then
    OLD_C=$(cat "$PF" 2>/dev/null || true)
    if [ -n "$OLD_C" ] && kill -0 "$OLD_C" 2>/dev/null; then
      log "Stopping previous process (PID $OLD_C)..."
      kill "$OLD_C" 2>/dev/null || true
    fi
    rm -f "$PF"
  fi
done
# Also stop stray proxy by pattern (pid file may be stale)
pkill -f "scripts/dev-proxy.mjs" 2>/dev/null || true
sleep 1

if [ -f "$DEV_PID_FILE" ]; then
  OLD_DEV=$(cat "$DEV_PID_FILE" 2>/dev/null || true)
  if [ -n "$OLD_DEV" ] && kill -0 "$OLD_DEV" 2>/dev/null; then
    log "Stopping previous dev (PID $OLD_DEV)..."
    kill "$OLD_DEV" 2>/dev/null || true
    sleep 2
  fi
  rm -f "$DEV_PID_FILE"
fi

# Next must bind :3000 (proxy + local browser).
if port_listen 3000; then
  err "Port 3000 is already in use. Stop that process (e.g. another \`next dev\`) so the proxy can reach this script's web, then retry."
  exit 1
fi
if port_listen "$PROXY_PORT"; then
  err "Port ${PROXY_PORT} is already in use. Stop whatever is bound there (dev-proxy), then retry."
  exit 1
fi

# ── 1. Prerequisites: Redis (+ local Mongo only if URI says so) ─
need_cmd npm
need_cmd node
need_cmd python3
if [ ! -f "$ENV_FILE" ]; then
  err "Missing $ENV_FILE — copy from .env.example and configure"
  exit 1
fi

MONGODB_URI_VAL=$(grep -E '^MONGODB_URI=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r' | sed "s/^[\"']//;s/[\"']$//")
if [ -z "$MONGODB_URI_VAL" ]; then
  err "MONGODB_URI is missing or empty in $ENV_FILE"
  exit 1
fi

REDIS_HOST_VAL=$(grep -E '^REDIS_HOST=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r' | sed "s/^[\"']//;s/[\"']$//")
REDIS_PORT_VAL=$(grep -E '^REDIS_PORT=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r' | sed "s/^[\"']//;s/[\"']$//")
REDIS_PORT_VAL="${REDIS_PORT_VAL:-6379}"

if redis_expects_local "$REDIS_HOST_VAL"; then
  log "Checking Redis (${REDIS_PORT_VAL})..."
  if ! port_listen "$REDIS_PORT_VAL"; then
    if try_start_redis_docker "$REDIS_PORT_VAL"; then
      ok "Redis is up (Docker Compose)"
    else
      err "Redis is not reachable on 127.0.0.1:${REDIS_PORT_VAL} — install/start redis-server, or run: docker compose up -d redis"
      exit 1
    fi
  else
    ok "Redis is up"
  fi
else
  ok "REDIS_HOST=${REDIS_HOST_VAL:-?} — skipped local Redis port check (use a reachable host from this machine)"
fi

if mongod_uri_expects_local "$MONGODB_URI_VAL"; then
  log "MONGODB_URI uses localhost — checking MongoDB (27017)..."
  if ! port_listen 27017; then
    err "MongoDB is not reachable on 127.0.0.1:27017 — start mongod or: docker compose up -d mongo"
    exit 1
  fi
  ok "MongoDB (local) is up"
else
  ok "MONGODB_URI is Atlas/remote — skipped local :27017 check"
fi

# ── 2. Kill stale tunnels; start reverse proxy + ngrok ───────
pkill -f "ngrok" 2>/dev/null || true
pkill -f "cloudflared tunnel" 2>/dev/null || true
sleep 1

log "Starting reverse proxy → web:3000 api:4010 rt:8000 on :${PROXY_PORT}"
> "$PROXY_LOG"
nohup node scripts/dev-proxy.mjs >> "$PROXY_LOG" 2>&1 &
echo $! > "$PROXY_PID_FILE"
ok "Proxy PID $(cat "$PROXY_PID_FILE") — log: $PROXY_LOG"

log "Starting ngrok → localhost:${PROXY_PORT} (${NGROK_DOMAIN})"
nohup ngrok http --url="$NGROK_DOMAIN" "$PROXY_PORT" > /tmp/ngrok-api.log 2>&1 &
NGROK_PID=$!

# ── 3. Update .env (one public origin for web + API + realtime) ─
set_env_var NEXT_PUBLIC_WEB_URL "$NGROK_PUBLIC_URL"
set_env_var NEXT_PUBLIC_API_URL "$NGROK_PUBLIC_URL"
set_env_var API_URL "$NGROK_PUBLIC_URL"
set_env_var NEXT_PUBLIC_SC_HOST "$NGROK_DOMAIN"
set_env_var NEXT_PUBLIC_SC_PORT "443"
set_env_var NEXT_PUBLIC_SC_SECURE "true"

# Next.js /__agentmarket_api rewrites must hit the API on this machine (not ngrok).
if grep -q '^NEXT_REWRITE_API_URL=' "$ENV_FILE"; then
  set_env_var NEXT_REWRITE_API_URL "http://127.0.0.1:4010"
else
  echo "NEXT_REWRITE_API_URL=http://127.0.0.1:4010" >> "$ENV_FILE"
fi
# Celery → Fastify internal routes (machine-local; not the ngrok URL)
if grep -q '^INTERNAL_API_URL=' "$ENV_FILE"; then
  set_env_var INTERNAL_API_URL "http://127.0.0.1:4010"
else
  echo "INTERNAL_API_URL=http://127.0.0.1:4010" >> "$ENV_FILE"
fi
# Google/Meta ads reporting + tools → Celery worker (not in-API google-ads-api)
if grep -q '^LEGACY_API_EXECUTION_ADS=' "$ENV_FILE"; then
  set_env_var LEGACY_API_EXECUTION_ADS "0"
else
  echo "LEGACY_API_EXECUTION_ADS=0" >> "$ENV_FILE"
fi

# Keep OAuth callbacks on the same static ngrok origin
set_env_var META_CALLBACK_URL_META_ADS "${NGROK_PUBLIC_URL}/callback/meta_ads"
set_env_var GOOGLE_ADS_CALLBACK_URL "${NGROK_PUBLIC_URL}/callback/google_ads"
set_env_var META_CALLBACK_URL_FACEBOOK_PAGE "${NGROK_PUBLIC_URL}/api/integrations/facebook_page/callback"
set_env_var INSTAGRAM_CALLBACK_URL "${NGROK_PUBLIC_URL}/api/integrations/instagram/callback"
set_env_var INSTAGRAM_LOGIN_CALLBACK_URL "${NGROK_PUBLIC_URL}/api/integrations/instagram_login/callback"
set_env_var LINKEDIN_CALLBACK_URL "${NGROK_PUBLIC_URL}/api/integrations/linkedin/callback"
set_env_var TIKTOK_CALLBACK_URL "${NGROK_PUBLIC_URL}/api/integrations/tiktok/callback"
set_env_var TWITTER_CALLBACK_URL "${NGROK_PUBLIC_URL}/api/integrations/twitter/callback"

ok ".env updated (unified public origin):"
ok "  NEXT_PUBLIC_WEB_URL=${NGROK_PUBLIC_URL}"
ok "  NEXT_PUBLIC_API_URL=${NGROK_PUBLIC_URL}"
ok "  API_URL=${NGROK_PUBLIC_URL}"
ok "  NEXT_PUBLIC_SC_HOST=${NGROK_DOMAIN} (wss :443 via ngrok → proxy → :8000)"
ok "  NEXT_REWRITE_API_URL=http://127.0.0.1:4010"
ok "  INTERNAL_API_URL=http://127.0.0.1:4010"
ok "  OAuth callbacks → ${NGROK_PUBLIC_URL}/..."
ok "  LEGACY_API_EXECUTION_ADS=0"

# ── 4. Install root deps if needed ───────────────────────────
if [ ! -d node_modules ] || [ ! -x node_modules/.bin/concurrently ]; then
  log "Installing npm dependencies (root)..."
  NODE_ENV=development npm install
fi
if [ ! -x node_modules/.bin/concurrently ]; then
  err "concurrently missing after npm install — run: npm install (repo root)"
  exit 1
fi

# ── 5. Celery (ai-worker): venv + deps; WORKER_API_SECRET required for worker ↔ API ─
WS=$(grep -E '^WORKER_API_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r' | sed "s/^[\"']//;s/[\"']$//")
if [ -z "$WS" ] || [ "${#WS}" -lt 8 ]; then
  err "WORKER_API_SECRET must be set in $ENV_FILE (min 8 characters). Example: openssl rand -hex 24"
  exit 1
fi

log "Preparing Celery (services/ai-worker) venv + pip dependencies..."
CELERY_PYTHON=""
for try in python3.12 python3.11 python3.10 python3; do
  if command -v "$try" >/dev/null 2>&1; then
    CELERY_PYTHON=$try
    break
  fi
done
[ -n "$CELERY_PYTHON" ] || { err "No python3 found for Celery venv"; exit 1; }
CELERY_PY_VER=$($CELERY_PYTHON -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo "?")
log "Celery interpreter: $CELERY_PYTHON (Python $CELERY_PY_VER)"
if [ "$CELERY_PY_VER" = "3.14" ]; then
  log "Note: Python 3.14 is supported for most deps; if pip fails, install python3.12 and re-run (dnf install python3.12)"
fi
log "Installing ai-worker packages (first run can take 1–3 minutes)..."
(
  cd services/ai-worker
  if [ -d .venv ]; then
    VENV_PY=$(
      .venv/bin/python -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo ""
    )
    if [ -n "$VENV_PY" ] && [ "$VENV_PY" != "$CELERY_PY_VER" ]; then
      log "Recreating .venv (was Python $VENV_PY, using $CELERY_PY_VER)..."
      rm -rf .venv
    fi
  fi
  test -d .venv || "$CELERY_PYTHON" -m venv .venv
  # shellcheck source=/dev/null
  . .venv/bin/activate
  pip install --upgrade pip wheel setuptools -q 2>/dev/null || true
  pip install -r requirements.txt
) || {
  err "Celery pip install failed — try: rm -rf services/ai-worker/.venv && ./start.sh"
  err "Or install Python 3.12: sudo dnf install python3.12 python3.12-devel"
  exit 1
}
ok "Celery environment ready"

# ── 6. Start API, web, realtime (npm workspaces) ─────────────
log "Starting local dev stack (api :4010, web :3000, realtime :8000)..."
> "$DEV_LOG"
nohup npm run dev:all >> "$DEV_LOG" 2>&1 &
echo $! > "$DEV_PID_FILE"
ok "Dev PID $(cat "$DEV_PID_FILE") — logs: $DEV_LOG"

# ── 7. Celery worker + beat ──────────────────────────────────
log "Starting Celery worker..."
> "$CELERY_WORKER_LOG"
(
  cd services/ai-worker
  # shellcheck source=/dev/null
  . .venv/bin/activate
  exec celery -A celery_app:celery_app worker -l info
) >> "$CELERY_WORKER_LOG" 2>&1 &
echo $! > "$CELERY_WORKER_PID_FILE"
ok "Celery worker PID $(cat "$CELERY_WORKER_PID_FILE") — log: $CELERY_WORKER_LOG"

log "Starting Celery beat..."
> "$CELERY_BEAT_LOG"
(
  cd services/ai-worker
  # shellcheck source=/dev/null
  . .venv/bin/activate
  exec celery -A celery_app:celery_app beat -l info
) >> "$CELERY_BEAT_LOG" 2>&1 &
echo $! > "$CELERY_BEAT_PID_FILE"
ok "Celery beat PID $(cat "$CELERY_BEAT_PID_FILE") — log: $CELERY_BEAT_LOG"

# ── 8. Wait for origins + proxy ──────────────────────────────
wait_for_origin_tcp 4010 "API" 120 || exit 1
wait_for_origin_http "http://127.0.0.1:3000/" "Web (Next.js)" 180 || exit 1
wait_for_origin_tcp 8000 "Realtime (SocketCluster)" 120 || exit 1
wait_for_origin_tcp "$PROXY_PORT" "Dev proxy" 30 || exit 1
wait_for_origin_http "http://127.0.0.1:${PROXY_PORT}/api/health" "Proxy → API" 30 || exit 1

# ── 9. Verify ngrok is up ───────────────────────────────────
sleep 2
NGROK_STATUS=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | python3 -c \
  "import sys,json; t=json.load(sys.stdin).get('tunnels',[]); print(t[0]['public_url'] if t else 'not ready')" 2>/dev/null || echo "not ready")

# ── 10. Final summary ───────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ok "Agent Market is running (local Node + Celery + ngrok)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Public    ${NGROK_PUBLIC_URL}"
echo "  Web       ${NGROK_PUBLIC_URL}/"
echo "  API       ${NGROK_PUBLIC_URL}/api/health"
echo "  Realtime  wss://${NGROK_DOMAIN}/socketcluster/"
echo ""
echo "  Local:    http://localhost:3000  (web)"
echo "            http://localhost:4010  (api)"
echo "            http://localhost:8000  (realtime)"
echo "            http://127.0.0.1:${PROXY_PORT}  (dev-proxy)"
echo ""
echo "  Ngrok UI: http://localhost:4040  (${NGROK_STATUS})"
echo ""
echo "  Logs:  tail -f $DEV_LOG"
echo "         tail -f $PROXY_LOG"
echo "         tail -f $CELERY_WORKER_LOG"
echo "         tail -f $CELERY_BEAT_LOG"
echo "  Note:  Free ngrok may show a browser warning (ERR_NGROK_6024) on first visit / OAuth —"
echo "         click Visit Site once, or add header ngrok-skip-browser-warning, then reconnect Meta."
echo "  Stop:  kill \$(cat $DEV_PID_FILE) 2>/dev/null; kill \$(cat $PROXY_PID_FILE) 2>/dev/null;"
echo "         kill \$(cat $CELERY_WORKER_PID_FILE) 2>/dev/null; kill \$(cat $CELERY_BEAT_PID_FILE) 2>/dev/null"
echo "         rm -f $DEV_PID_FILE $PROXY_PID_FILE $CELERY_WORKER_PID_FILE $CELERY_BEAT_PID_FILE"
echo "         pkill -f 'ngrok|scripts/dev-proxy.mjs'   # optional: tunnel + proxy"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
