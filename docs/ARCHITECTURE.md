# Agent-Market Architecture

## Modules

### 1. Social Automation

- Draft posts with LLM
- Generate visuals
- Schedule publishing
- Analyze comments and propose replies

### 2. Google Ads Automation

- Keyword research
- Asset generation (titles/descriptions)
- Landing page generation workflow
- Budget pacing and KPI optimization

---

## Runtime Components

- **`apps/web`** — Next.js control tower
- **`apps/api`** — Fastify orchestration API
- **`services/realtime`** — SocketCluster for live events and monitoring
- **`services/ai-worker`** — Python Celery jobs for AI workloads
- **mongodb** — source of truth for campaigns, posts, comments, metrics
- **redis** — queue + cache + event bridge

---

## Data Flow (high level)

1. User starts workflow from web dashboard.
2. Fastify API stores job payload in MongoDB.
3. API enqueues Celery task via Redis.
4. Worker executes AI step and persists output.
5. API broadcasts progress events through SocketCluster.
6. Dashboard updates in real-time.
