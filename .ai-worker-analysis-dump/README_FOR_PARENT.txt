AI Worker technical dump — full source contents for analysis.

Location: /home/sonofogre/Desktop/agent-market/.ai-worker-analysis-dump/

PRIMARY ARTIFACTS (read these):
- SOURCE_ONLY_CONCATENATED.txt  (~43k lines, 1.6MB) — ALL requested source with FILE: headers
- FILE_INDEX.txt                — line counts for every ai-worker + model file
- CAT_CORE.txt                  — docker-compose, package.json, celery_app, dispatcher, worker_api, enqueue
- CAT_PROMPTS.txt               — all prompts/*.md
- CAT_REGISTRY.txt              — registry/tools.json
- CAT_SCHEMAS.txt               — schemas/ads/*.json
- CAT_WORKER_INTERNAL.txt       — apps/api/src/routes/worker_internal.js
- CAT_CONNECTORS.txt            — connectors/**/*.py (~16k lines)
- CAT_TASKS.txt                 — tasks/**/*.py (~4.8k lines)
- CAT_LIB.txt                   — lib/**/*.py (~14k lines)
- CAT_MODELS.txt               — apps/api/src/models/*.js
- CAT_AGENT_TASKS.txt           — plan/execute workflow + executor + orchestrator

Architecture communication path:
  Browser → Next.js web → Fastify API → Redis LPUSH CELERY_REDIS_LIST
  → Celery Beat bridge_api_celery_queue → Celery worker tasks
  → connectors (platform APIs) + lib/llm + lib/dispatch
  → worker_api HTTP client → /api/internal/worker/* (X-Worker-Secret)
  → MongoDB (API owns persistence)
  → Redis pub/sub → SocketCluster realtime → web

Original paths (prefer these over dump copies):
  /home/sonofogre/Desktop/agent-market/services/ai-worker/
  /home/sonofogre/Desktop/agent-market/apps/api/src/routes/worker_internal.js
