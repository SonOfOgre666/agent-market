#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Agent Market — local startup (no Docker for app stack)
# Redis: checks local port when REDIS_HOST is localhost; otherwise skips.
# If local Redis is down and Docker is available, runs: docker compose up -d redis
# MongoDB: local :27017 only when MONGODB_URI points at this machine; Atlas skips.
# Starts: ngrok + cloudflared, API + web + realtime (npm), Celery worker + beat (ai-worker).
# Prerequisite: Redis reachable (e.g. docker compose up -d redis) and Mongo (e.g. Atlas in .env).
# ─────────────────────────────────────────────────────────────
set -e
cd "$(dirname "$0")"

NGROK_DOMAIN="chelsie-unsignalised-noncommendably.ngrok-free.dev"
ENV_FILE=".env"
DEV_LOG="/tmp/agent-market-dev.log"
DEV_PID_FILE="/tmp/agent-market-dev.pid"
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

# Keep only a real trycloudflare *quick tunnel* URL (not api.trycloudflare.com from error lines).
# Quick tunnels always look like: https://word-word-word.trycloudflare.com
is_valid_quick_tunnel_url() {
  [[ "$1" =~ ^https://[a-z0-9]+(-[a-z0-9]+)+\.trycloudflare\.com/?$ ]]
}

extract_quick_tunnel_url() {
  local logfile="$1"
  local url=""
  # Banner line: "Visit it at ... https://random-words.trycloudflare.com"
  url=$(grep -oE 'https://[a-z0-9]+(-[a-z0-9]+)+\.trycloudflare\.com' "$logfile" 2>/dev/null | head -1)
  if is_valid_quick_tunnel_url "$url"; then
    printf '%s' "${url%/}"
    return 0
  fi
  printf '%s' ''
}

sanitize_cf_url() {
  local candidate
  candidate=$(printf '%s' "$1" | tr -d '\r\n' | grep -oE 'https://[a-z0-9]+(-[a-z0-9]+)+\.trycloudflare\.com' | head -1)
  if is_valid_quick_tunnel_url "$candidate"; then
    printf '%s' "${candidate%/}"
  fi
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

# Wait until local origins respond (avoids Cloudflare 502 right after script exits).
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

# ── 0. Stop previous Celery + local dev (same script) ─────────
for PF in "$CELERY_WORKER_PID_FILE" "$CELERY_BEAT_PID_FILE"; do
  if [ -f "$PF" ]; then
    OLD_C=$(cat "$PF" 2>/dev/null || true)
    if [ -n "$OLD_C" ] && kill -0 "$OLD_C" 2>/dev/null; then
      log "Stopping previous Celery (PID $OLD_C)..."
      kill "$OLD_C" 2>/dev/null || true
    fi
    rm -f "$PF"
  fi
done
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

# Cloudflared (web) targets localhost:3000 — Next must bind :3000, not 3001.
if port_listen 3000; then
  err "Port 3000 is already in use. Stop that process (e.g. another \`next dev\`) so tunnels match this script, then retry."
  exit 1
fi

# ── 1. Prerequisites: Redis (+ local Mongo only if URI says so) ─
need_cmd npm
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

get_cf_url() {
  local logfile="$1"
  local port="$2"
  local url=""
  for attempt in 1 2 3 4 5; do
    for i in $(seq 1 45); do
      url=$(extract_quick_tunnel_url "$logfile")
      if [ -n "$url" ]; then
        printf '%s' "$url"
        return 0
      fi
      if grep -qE 'context deadline exceeded|failed to request quick Tunnel' "$logfile" 2>/dev/null; then
        break
      fi
      sleep 1
    done
    log "Cloudflare quick tunnel not ready on port $port (attempt $attempt/5)..."
    if grep -q 'api.trycloudflare.com/tunnel' "$logfile" 2>/dev/null; then
      log "  (cloudflared could not reach Cloudflare — check network/DNS/firewall)"
    fi
    pkill -f "cloudflared tunnel --url http://localhost:${port}" 2>/dev/null || true
    sleep 2
    > "$logfile"
    nohup cloudflared tunnel --url "http://localhost:${port}" >> "$logfile" 2>&1 &
    sleep 3
  done
  printf '%s' ''
}

CF_WEB_URL=$(sanitize_cf_url "$(get_cf_url /tmp/cf-web.log 3000)")
CF_RT_URL=$(sanitize_cf_url "$(get_cf_url /tmp/cf-rt.log 8000)")

if [ -z "$CF_WEB_URL" ]; then
  err "Could not detect web cloudflare URL after 5 attempts — check /tmp/cf-web.log"
  err "If you see 'failed to request quick Tunnel: Post https://api.trycloudflare.com/tunnel', fix outbound HTTPS/DNS and retry."
  exit 1
fi
if [ -z "$CF_RT_URL" ]; then
  err "Could not detect realtime cloudflare URL after 5 attempts — check /tmp/cf-rt.log"
  exit 1
fi
if ! is_valid_quick_tunnel_url "$CF_WEB_URL" || ! is_valid_quick_tunnel_url "$CF_RT_URL"; then
  err "Invalid Cloudflare tunnel URL(s) — got web='${CF_WEB_URL}' rt='${CF_RT_URL}'"
  exit 1
fi

CF_RT_HOST=$(echo "$CF_RT_URL" | sed 's|https://||')

# Public API URL (HTTPS) — required when the web UI is served over HTTPS
# (e.g. trycloudflare): the browser blocks fetch() to http://localhost (mixed content).
NGROK_API_URL="https://${NGROK_DOMAIN}"

# ── 7. Update .env (tunnels + browser-safe API base URL) ──────
set_env_var NEXT_PUBLIC_WEB_URL "$CF_WEB_URL"
set_env_var NEXT_PUBLIC_SC_HOST "$CF_RT_HOST"
if grep -q '^NEXT_PUBLIC_API_URL=' "$ENV_FILE"; then
  set_env_var NEXT_PUBLIC_API_URL "$NGROK_API_URL"
else
  echo "NEXT_PUBLIC_API_URL=${NGROK_API_URL}" >> "$ENV_FILE"
fi
# Next.js /__agentmarket_api rewrites must hit the API on this machine (not ngrok) or server-side proxy often 502s.
if grep -q '^NEXT_REWRITE_API_URL=' "$ENV_FILE"; then
  set_env_var NEXT_REWRITE_API_URL "http://127.0.0.1:4010"
else
  echo "NEXT_REWRITE_API_URL=http://127.0.0.1:4010" >> "$ENV_FILE"
fi
if grep -q '^API_URL=' "$ENV_FILE"; then
  set_env_var API_URL "$NGROK_API_URL"
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

ok ".env updated:"
ok "  NEXT_PUBLIC_WEB_URL=${CF_WEB_URL}"
ok "  NEXT_PUBLIC_SC_HOST=${CF_RT_HOST}"
ok "  NEXT_PUBLIC_API_URL=${NGROK_API_URL} (avoids mixed-content when using Try Cloudflare)"
ok "  NEXT_REWRITE_API_URL=http://127.0.0.1:4010 (Next /__agentmarket_api → local API; avoids Node→ngrok 502)"
ok "  INTERNAL_API_URL=http://127.0.0.1:4010 (Celery worker → API internal routes)"
ok "  LEGACY_API_EXECUTION_ADS=0 (ads reporting via Celery worker)"

# ── 8. Install root deps if needed ───────────────────────────
if [ ! -d node_modules ] || [ ! -x node_modules/.bin/concurrently ]; then
  log "Installing npm dependencies (root)..."
  NODE_ENV=development npm install
fi
if [ ! -x node_modules/.bin/concurrently ]; then
  err "concurrently missing after npm install — run: npm install (repo root)"
  exit 1
fi

# ── 8b. Celery (ai-worker): venv + deps; WORKER_API_SECRET required for worker ↔ API ─
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

# ── 9. Start API, web, realtime (npm workspaces) ─────────────
log "Starting local dev stack (api :4010, web :3000, realtime :8000)..."
> "$DEV_LOG"
nohup npm run dev:all >> "$DEV_LOG" 2>&1 &
echo $! > "$DEV_PID_FILE"
ok "Dev PID $(cat "$DEV_PID_FILE") — logs: $DEV_LOG"

# ── 9c. Celery worker + beat (same Redis/Mongo as in .env; INTERNAL_API_URL defaults in worker_api) ─
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

# ── 9b. Wait for origins (Cloudflare 502 if you open the URL before this) ─
wait_for_origin_tcp 4010 "API" 120 || exit 1
wait_for_origin_http "http://127.0.0.1:3000/" "Web (Next.js)" 180 || exit 1
wait_for_origin_tcp 8000 "Realtime (SocketCluster)" 120 || exit 1

# ── 10. Verify ngrok is up ───────────────────────────────────
sleep 2
NGROK_STATUS=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | python3 -c \
  "import sys,json; t=json.load(sys.stdin).get('tunnels',[]); print(t[0]['public_url'] if t else 'not ready')" 2>/dev/null || echo "not ready")

# ── 11. Final summary ───────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ok "Agent Market is running (local Node + Celery + tunnels)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  API       https://${NGROK_DOMAIN}"
echo "  Health    https://${NGROK_DOMAIN}/api/health"
echo "  Web       ${CF_WEB_URL}"
echo "  Realtime  wss://${CF_RT_HOST}"
echo ""
echo "  Local:    http://localhost:3000  (web)"
echo "            http://localhost:4010  (api)"
echo ""
echo "  Ngrok UI: http://localhost:4040  (${NGROK_STATUS})"
echo ""
echo "  Logs:  tail -f $DEV_LOG"
echo "         tail -f $CELERY_WORKER_LOG"
echo "         tail -f $CELERY_BEAT_LOG"
echo "  Note:  Cloudflare shows 502 until Next/realtime are up; this script now waits for that."
echo "  Stop:  kill \$(cat $DEV_PID_FILE) 2>/dev/null; kill \$(cat $CELERY_WORKER_PID_FILE) 2>/dev/null; kill \$(cat $CELERY_BEAT_PID_FILE) 2>/dev/null"
echo "         rm -f $DEV_PID_FILE $CELERY_WORKER_PID_FILE $CELERY_BEAT_PID_FILE"
echo "         pkill -f 'ngrok|cloudflared tunnel'   # optional: tunnels only"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
