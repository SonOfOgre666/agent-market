# Agent-Market — Architecture

> Vue d'ensemble runtime. Pour le guide développeur détaillé (setup, endpoints, collections), voir **[ONBOARDING.md](ONBOARDING.md)**.

---

## Product modules

### 1. Social automation

- Draft and schedule posts across LinkedIn, Instagram, Facebook, Twitter/X, TikTok
- Multi-account publishing via `post_accounts`
- Comment sync, LLM analysis, and reply suggestions
- Imported post history and audience/metrics sync (Celery imports)

### 2. Ads automation (Google Ads + Meta)

- Campaign CRUD, native publish (Search, Display, PMax, Meta)
- ~150 agent tools under `services/ai-worker/tools/ads/`
- Reporting (GAQL, Meta insights), budget pacing, bid optimization
- Landing page generation and lead capture with UTM attribution

### 3. SEO

- AI keyword clustering
- SERP rank checks (DuckDuckGo scrape)
- Landing page SEO audit (rule-based on Mongo data)

### 4. AI agent (Marketing Assistant)

- Conversational planner (`/api/agent/chat`)
- Multi-step workflows with approval and execution (`plan_workflow`, `execute_workflow`)
- Tool registry: ads mutations, content generation, SEO, competitive analysis

### 5. Platform & tenancy

- JWT auth, multi-workspace membership, invites
- Per-workspace AI provider config (`integrations` + `ai_workspace_configs`)
- Media library (local or S3), settings, audit `event_logs`

---

## Runtime components

| Component | Path | Role |
| --------- | ---- | ---- |
| **Web** | `apps/web` | Next.js 15 App Router — dashboard, ads UI, agent chat, SEO, settings |
| **API** | `apps/api` | Fastify 5 — REST, JWT, OAuth, enqueue Celery, publish Redis events |
| **Realtime** | `services/realtime` | SocketCluster — Redis pub/sub → WebSocket channel `events` |
| **AI worker** | `services/ai-worker` | Celery worker + Beat — publish, imports, LLM, ads tools, schedulers |
| **MongoDB 7** | `docker-compose.yml` | Source of truth (posts, campaigns, accounts, workflows, metrics) |
| **Redis 7** | `docker-compose.yml` | Celery broker, API→worker bridge list, cache, pub/sub |

---

## Request flow

```
Browser (Next.js)
      │
      ▼
Fastify API ──────────────► MongoDB (persist state)
      │
      ├── LPUSH CELERY_REDIS_LIST ──► Beat: bridge_api_celery_queue ──► Celery task
      │                                         │
      │                                         ├── connectors/ (platform APIs)
      │                                         ├── lib/llm/ (Gemini, OpenAI, Anthropic, Ollama)
      │                                         └── worker_api → INTERNAL_API_URL (publish bundle)
      │
      ├── sync Celery round-trip (/api/ai/*, ads P2) ──► Redis reply key ──► poll job
      │
      └── PUBLISH EVENTS_CHANNEL ──► SocketCluster ──► RealtimeProvider (web)
```

### Celery bridge

The API does **not** call Celery directly. It `LPUSH`es JSON task envelopes onto **`CELERY_REDIS_LIST`** (default `agentmarket:api_task_bridge`). Beat runs **`tasks.bridge_api_celery_queue`** every 5s to forward them into the Celery broker.

### Worker → API boundary

Post publish and schedulers call **`/api/internal/worker/*`** with **`WORKER_API_SECRET`**. The worker does not mutate posts directly in Mongo for publish flows — the API owns persistence.

### Synchronous AI / ads execution

- **`/api/ai/*`** — enqueue `tasks.ai.gemini_sync`, poll `/api/ai/jobs/:jobId` via Redis reply prefix
- **Ads P2** (default) — Google/Meta reporting and tool execution in Celery when `LEGACY_API_EXECUTION_ADS=0`

---

## API layer (`apps/api`)

| Area | Key paths |
| ---- | --------- |
| Boot | `src/index.js` → `server.js`, routes in `registerRoutes.js` |
| Auth | `middleware/auth.js`, `routes/auth.js`, `routes/workspace.js` |
| Models | `src/models/*.js` — one file per domain entity |
| Providers | `src/providers/` — OAuth and platform adapters (Node) |
| Enqueue | `lib/celeryEnqueue.js`, `lib/agentCeleryBridge.js`, `lib/aiCeleryBridge.js` |
| Events | `lib/events.js` — Redis pub/sub + `event_logs` |
| Media | `media/processor.js` — sharp, ffmpeg |

---

## Worker layer (`services/ai-worker`)

| Area | Key paths |
| ---- | --------- |
| Celery app | `celery_app.py` — broker config + `beat_schedule` |
| Tasks | `tasks/` — `social/`, `ads/`, `seo/`, `agent/`, `imports/`, `analytics/`, `bridge.py`, `scheduler_beat.py` |
| Connectors | `connectors/` — `google_ads/`, `meta_ads/`, `linkedin.py`, `twitter.py`, `instagram.py`, `tiktok.py`, … |
| LLM | `lib/llm/` — `router.py`, provider modules (`gemini`, `openai`, `anthropic`, `ollama`, `openrouter`) |
| Planner | `lib/planner/` — agent workflow planning, ads session, campaign specs |
| Tools | `tools/ads/google/`, `tools/ads/meta/` — agent-callable mutations and reporting |
| Prompts | `prompts/` — markdown templates per feature |

---

## Realtime

1. API or worker calls `publishEvent()` → `redis.publish(EVENTS_CHANNEL, payload)`
2. `services/realtime/server.js` subscribes and broadcasts on SocketCluster channel **`events`**
3. `apps/web/components/RealtimeProvider.js` + `lib/socket.js` update the UI

---

## Multi-tenancy

- Every authenticated request carries **`workspace_id`** (JWT claim, switchable via `/api/switch-workspace`)
- Collections are scoped by `workspace_id` where applicable
- OAuth tokens and AI keys live in **`integrations`** (encrypted with `APP_KEY`) per workspace
- Feature-to-provider mapping in **`ai_workspace_configs`** + catalog seed **`ai_catalog`**

---

## Deployment topology

**Local dev (hybrid):** `docker compose up -d mongo redis` + `npm run dev` + `make worker beat`

**Full Docker:** `docker compose up -d` — all services including celery-worker and celery-beat

**Production images:** CI builds and pushes to GHCR; `docker-compose.prebuilt.yml` pulls prebuilt images. See root **README.md**.
