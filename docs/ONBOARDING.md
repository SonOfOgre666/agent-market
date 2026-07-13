# Agent-Market — Guide d'onboarding développeur

> **Dernière mise à jour** : juillet 2026  
> **Complément** : vue architecture runtime → **[ARCHITECTURE.md](ARCHITECTURE.md)** · démarrage rapide → **[README.md](../README.md)**

---

## 1. C'est quoi Agent-Market ?

Agent-Market est une **plateforme de gestion marketing cross-plateforme pilotée par l'IA**. Elle centralise dans une seule « tour de contrôle » :

- La **gestion des réseaux sociaux** (LinkedIn, Instagram, TikTok, Facebook, Twitter/X)
- La **gestion des campagnes publicitaires** (Google Ads, Meta Ads)
- L'**optimisation SEO/SEA automatisée par IA**
- Un **agent IA conversationnel** (workflows multi-étapes, outils ads/SEO/contenu)
- Le **suivi budgétaire** et des **KPIs en temps réel**

Chaque utilisateur travaille dans un **workspace** (JWT). Les clés IA (Gemini, OpenAI, Anthropic, Ollama) se configurent **par workspace** dans l'UI — pas dans `.env`.

---

## 2. Stack technique

### Frontend (`apps/web`)

| Techno | Version | Rôle |
| ------ | ------- | ---- |
| **Next.js** | 15.3.x | App Router, pages dynamiques |
| **React** | 19.0.0 | Composants UI |
| **SocketCluster Client** | 20.x | WebSocket temps réel |
| **CSS pur** | — | Styles dans `app/globals.css` (pas de Tailwind) |

### Backend API (`apps/api`)

| Techno | Version | Rôle |
| ------ | ------- | ---- |
| **Fastify** | 5.1.0 | API REST |
| **MongoDB** (driver natif) | 6.12.0 | Base principale (pas Mongoose) |
| **ioredis** | 5.4.1 | Cache, bridge Celery, pub/sub |
| **sharp / fluent-ffmpeg** | — | Traitement média |

### Temps réel (`services/realtime`)

| Techno | Version | Rôle |
| ------ | ------- | ---- |
| **SocketCluster Server** | 20.x | Relay WebSocket |
| **ioredis** | 5.4.1 | Subscribe `EVENTS_CHANNEL` → broadcast |

### AI Worker (`services/ai-worker`)

| Techno | Version | Rôle |
| ------ | ------- | ---- |
| **Python** | 3.11+ (CI 3.12) | Runtime worker |
| **Celery** | 5.3.6 | File d'attente + Beat |
| **Redis** | 5.0.1 | Broker |
| **google-ads** | 28.x+ | API Google Ads |
| **OpenAI / Anthropic SDK** | — | Génération LLM |
| **PyMongo** | 4.6.1 | Accès MongoDB côté worker |

### Infrastructure

| Techno | Rôle |
| ------ | ---- |
| **MongoDB 7** | Source de vérité |
| **Redis 7** | Broker Celery + bridge API + pub/sub |
| **Docker Compose** | Stack complète ou mongo/redis seuls |

---

## 3. Architecture du projet

```
agent-market/
├── .env / .env.example
├── docker-compose.yml          # mongo, redis, api, web, realtime, celery-worker, celery-beat
├── docker-compose.prebuilt.yml # images GHCR
├── Makefile                    # up, down, dev, worker, beat, check
├── start.sh / start_with_docker.sh
├── package.json                # workspaces npm
├── apps/
│   ├── api/                    # Fastify :4010
│   │   └── src/
│   │       ├── index.js        # → server.js
│   │       ├── registerRoutes.js
│   │       ├── server.js       # plugins, listen
│   │       ├── middleware/auth.js
│   │       ├── lib/            # mongo, redis, events, celeryEnqueue, aiCeleryBridge…
│   │       ├── models/         # Post, Campaign, Account, Workspace, AgentWorkflow…
│   │       ├── providers/      # linkedin, twitter, meta, google_ads, tiktok…
│   │       ├── routes/         # auth, posts, ads, agent, seo, ai, integrations…
│   │       └── media/          # processor, downloader
│   └── web/                    # Next.js :3000
│       └── app/                # pages par module (posts, ads, agent, seo…)
│           ├── components/
│           └── lib/              # socket.js, helpers ads/SEO
├── services/
│   ├── realtime/               # SocketCluster :8000
│   └── ai-worker/
│       ├── celery_app.py       # broker + beat_schedule
│       ├── connectors/         # google_ads/, meta_ads/, linkedin, twitter…
│       ├── tasks/              # social/, ads/, seo/, agent/, imports/, bridge.py
│       ├── lib/llm/            # router, gemini, openai, anthropic, ollama
│       ├── lib/planner/        # agent planning, ads session
│       ├── tools/ads/          # outils agent Google/Meta
│       └── prompts/            # templates markdown par feature
└── docs/
    ├── ONBOARDING.md           # ce fichier
    └── ARCHITECTURE.md
```

---

## 4. Flux de données

```
Utilisateur (Dashboard Next.js)
        │
        ▼
   API Fastify ──────── MongoDB (persist)
        │
        ├── LPUSH CELERY_REDIS_LIST
        │         │
        │         ▼
        │   Beat: bridge_api_celery_queue (toutes les 5s)
        │         │
        │         ▼
        │   Celery Worker
        │         ├── lib/llm/ (Gemini, OpenAI, Anthropic…)
        │         ├── connectors/ (Google Ads, Meta, LinkedIn…)
        │         └── GET /api/internal/worker/* (publish, bundles)
        │
        └── redis.publish(EVENTS_CHANNEL) ──► SocketCluster ──► Dashboard
```

1. L'utilisateur déclenche une action (UI ou agent)
2. L'API persiste l'état dans MongoDB
3. L'API enqueue via `CELERY_REDIS_LIST` (ou round-trip sync pour `/api/ai/*`)
4. Le worker exécute et rappelle l'API interne si nécessaire
5. `publishEvent()` notifie le dashboard en temps réel

---

## 5. Collections MongoDB

| Collection | Contenu |
| ---------- | ------- |
| **`users`** | Comptes utilisateurs |
| **`workspaces`** | Tenants, membres, rôles |
| **`workspace_invites`** | Invitations en attente |
| **`accounts`** | Comptes connectés (social + `google_ads` / `meta_ads`) |
| **`posts`** | Posts sociaux (draft, scheduled, published) |
| **`post_accounts`** | Liaison post ↔ comptes cibles |
| **`post_comments`** | Commentaires synchronisés par plateforme |
| **`social_comments`** | File d'analyse commentaires |
| **`imported_posts`** | Historique importé (Twitter, etc.) |
| **`media`** | Bibliothèque média |
| **`metrics`**, **`audience`**, **`facebook_insights`** | Métriques par compte |
| **`ads_campaigns`** | Campagnes publicitaires |
| **`ads_landing_pages`** | Landing pages générées |
| **`ads_leads`** | Leads capturés (UTM) |
| **`ads_metrics`** | Snapshots performance campagne |
| **`ads_keyword_research`** | Historique recherche mots-clés |
| **`integrations`** | Config chiffrée (OAuth tokens, clés IA par workspace) |
| **`ai_workspace_configs`** | Mapping feature → provider/modèle |
| **`ai_catalog`** | Catalogue features IA (seed) |
| **`ai_executions`** | Journal exécutions IA |
| **`agent_conversations`** | Historique chat agent |
| **`agent_workflows`** | Workflows planifiés / exécutés |
| **`settings`** | Préférences workspace |
| **`event_logs`** | Audit trail événements |
| **`tags`** | Tags posts |

Modèles : `apps/api/src/models/*.js` · index : `apps/api/src/lib/mongo.js`.

---

## 6. Intégrations plateformes (OAuth)

| Plateforme | Statut | Connexion |
| ---------- | ------ | --------- |
| **LinkedIn** | Implémenté | `/api/integrations/linkedin/connect` |
| **Instagram (Meta)** | Implémenté | `/api/integrations/instagram/connect` |
| **Instagram Login** | Implémenté | flux direct sans page Facebook |
| **TikTok** | Implémenté | `/api/integrations/tiktok/connect` |
| **Twitter/X** | Implémenté | `/api/integrations/twitter/connect` |
| **Facebook Page** | Implémenté | `/callback/facebook_page` |
| **Meta Ads** | Implémenté | `/callback/meta_ads` + comptes ads |
| **Google Ads** | Implémenté | `/api/integrations/google-ads/connect` ou `/callback/google_ads` |

**Diagnostic** : `GET /api/integrations/diagnostics` (JWT workspace)

Callbacks et variables : voir **README.md** § OAuth et `.env.example`.

---

## 7. API Endpoints (référence)

> Toutes les routes ci-dessous sous `/api` exigent un **JWT workspace** sauf mention contraire.

### Auth & workspace

| Méthode | Route | Description |
| ------- | ----- | ----------- |
| `POST` | `/api/login`, `/api/register` | Auth |
| `GET` | `/api/me` | Utilisateur courant |
| `POST` | `/api/switch-workspace` | Changer de workspace actif |
| `GET/PATCH` | `/api/workspace` | Détail / mise à jour workspace |
| `POST` | `/api/workspace/invite` | Inviter un membre |

### Posts & calendrier

| Méthode | Route | Description |
| ------- | ----- | ----------- |
| `GET/POST/PATCH` | `/api/posts` | CRUD posts |
| `POST` | `/api/posts/:id/publish` | Publier via `tasks.social.publish_post` |
| `POST` | `/api/posts/:id/schedule` | Planifier |
| `POST` | `/api/calendar/suggestions/generate` | Suggestions calendrier IA |

### Commentaires

| Méthode | Route | Description |
| ------- | ----- | ----------- |
| `POST` | `/api/posts/comments/analyze` | Analyse LLM |
| Routes | `/api/social-comments/*` | Sync et gestion commentaires |

### SEO

| Méthode | Route | Description |
| ------- | ----- | ----------- |
| `POST` | `/api/seo/keywords/cluster` | Clustering mots-clés |
| `POST` | `/api/seo/keywords/check-ranks` | Suivi SERP |
| `GET` | `/api/seo/landing-pages/audit` | Audit landing pages |

### Ads (Google + Meta)

| Méthode | Route | Description |
| ------- | ----- | ----------- |
| `POST` | `/api/ads/keywords/suggest` | Suggestion mots-clés |
| `GET/POST` | `/api/ads/campaigns` | CRUD campagnes |
| `POST` | `/api/ads/campaigns/:id/generate-assets` | Assets RSA |
| `POST` | `/api/ads/campaigns/:id/generate-landing-page` | Landing page |
| `POST` | `/api/ads/campaigns/:id/optimize` | Optimisation KPI |
| `POST` | `/api/ads/budget/pacing` | Pacing budgétaire |
| `POST` | `/api/ads/budget/reallocation` | Réallocation |
| `POST` | `/api/ads/optimization/bid` | Enchères CPA/ROAS |
| `GET` | `/api/ads/optimization/quality-score` | Quality Score |
| `POST` | `/api/ads/optimization/asset-ab` | A/B annonces |
| `GET` | `/api/ads/reports/kpi-pdf` | Rapport PDF |
| `POST` | `/api/ads/negative-keywords/suggest` | Mots-clés négatifs |
| `POST` | `/api/ads/competitive-analysis` | Analyse concurrentielle |
| `POST` | `/api/ads/google-ads/sync` | Sync campagnes Google |
| `GET/POST` | `/api/ads/landing-pages`, `/api/ads/leads` | Landing pages & leads |

### Agent IA

| Méthode | Route | Description |
| ------- | ----- | ----------- |
| `GET` | `/api/agent/conversations`, `/api/agent/workflows` | Historique |
| `POST` | `/api/agent/chat` | Message → plan workflow |
| `POST` | `/api/agent/chat/complete` | Complétion synchrone |
| `POST` | `/api/agent/workflows/:id/approve` | Approuver le plan |
| `POST` | `/api/agent/workflows/:id/execute` | Exécuter |
| `POST` | `/api/agent/workflows/:id/cancel` | Annuler |
| `GET` | `/api/agent/jobs/:jobId` | Poll job Celery |

### IA synchrone & config workspace

| Méthode | Route | Description |
| ------- | ----- | ----------- |
| `POST` | `/api/ai/generate-post`, `/api/ai/generate-image`, … | Génération contenu |
| `GET` | `/api/ai/jobs/:jobId` | Poll résultat |
| `GET` | `/api/ai/workspace` | Config IA workspace (admin) |
| `PUT` | `/api/ai/providers/:name` | Connecter un provider |
| `GET` | `/api/ai/catalog` | Catalogue features |

### Dashboard & divers

| Méthode | Route | Description |
| ------- | ----- | ----------- |
| `GET` | `/api/dashboard` | KPIs workspace |
| `GET` | `/api/health` | Santé Mongo + Redis (sans JWT) |
| `GET/POST` | `/api/media` | Bibliothèque média |
| `GET/POST` | `/api/accounts` | Comptes connectés |

Catalogue complet des routes : `apps/api/src/registerRoutes.js`.

---

## 8. Celery Beat (tâches planifiées)

Source : `services/ai-worker/celery_app.py`

| Tâche Beat | Fréquence | Rôle |
| ---------- | --------- | ---- |
| `tasks.bridge_api_celery_queue` | 5s | Pont `CELERY_REDIS_LIST` → broker Celery |
| `tasks.scheduler.tick_due_posts` | 60s | Publie posts planifiés |
| `tasks.scheduler.tick_due_campaigns` | 60s | Publie campagnes planifiées |
| `tasks.scheduler.tick_comment_sync` | 15 min | Sync commentaires |
| `tasks.optimize_active_campaigns` | :30 chaque heure | Optimisation campagnes actives |
| `tasks.scheduler.hourly_import_followers` | :00 chaque heure | Import followers |
| `tasks.scheduler.six_hourly_twitter_posts` | toutes les 6h | Import posts Twitter |
| `tasks.scheduler.hourly_budget_alerts` | :00 | Alertes budget |
| `tasks.scheduler.hourly_budget_pacing` | :15 | Pacing budgétaire |
| `tasks.scheduler.hourly_bid_optimization` | :45 | Optimisation enchères |
| `tasks.scheduler.daily_negative_keyword_review` | 07:30 UTC | Revue search terms |
| `tasks.scheduler.daily_metrics_midnight_utc` | 00:00 UTC | Agrégation métriques |
| `tasks.scheduler.daily_delete_old_imports` | 04:00 UTC | Purge imports anciens |
| `tasks.scheduler.daily_prune_upload_tmp` | 03:00 UTC | Nettoyage uploads temp |
| `tasks.scheduler.weekly_report_monday_8utc` | lundi 08:00 UTC | Snapshots rapport KPI |
| `tasks.scheduler.ads_platform_sync_daily` | 06:00 UTC | Sync Google/Meta |

Beat optionnel via `.env` : `ADS_PACING_AUTO_PAUSE`, `ADS_BID_AUTO_APPLY`.

---

## 9. État d'avancement (implémenté / partiel / à venir)

### 9.1 — Réseaux sociaux

| Fonctionnalité | État |
| -------------- | ---- |
| OAuth + publication Facebook / Instagram / Twitter / LinkedIn | Implémenté |
| Planification + métriques posts (FB, IG, Twitter, LinkedIn) | Implémenté |
| TikTok publication | Partiel — métriques Business API non branchées |
| Analyse commentaires LLM | Implémenté (échec explicite si LLM indisponible) |
| Publication multi-canal simultanée | Partiel — un post, comptes multiples |

### 9.2 — Google Ads + Meta

| Fonctionnalité | État |
| -------------- | ---- |
| API Google Ads (CRUD, reporting, mutations) | Implémenté (~150 tools agent) |
| Création campagnes Search/Display/PMax via agent | Implémenté |
| Sync campagnes + reporting UI | Implémenté |
| Optimisation budget / enchères / QS / A/B | Implémenté (UI + agent + Beat) |
| Meta Ads publish + insights | Implémenté |

### 9.3 — SEO

| Fonctionnalité | État |
| -------------- | ---- |
| Clustering keywords IA | Implémenté |
| Suivi positions SERP | Implémenté (scrape DuckDuckGo) |
| Audit landing pages | Partiel — règles Mongo, pas de crawl live |
| Crawl technique complet (CWV, sitemap, liens) | À venir |

### 9.4 — IA & contenu

| Fonctionnalité | État |
| -------------- | ---- |
| Calendrier éditorial IA | Implémenté (on-demand via `/api/calendar`) |
| RSA / landing page copy | Implémenté (LLM requis) |
| Analyse concurrentielle | Implémenté |
| Génération visuels / vidéo | Partiel — via agent et `/api/ai/generate-*` |

### 9.5 — Budget & KPIs

| Fonctionnalité | État |
| -------------- | ---- |
| Dashboard budget + pacing | Implémenté |
| Rapport PDF KPI | Implémenté |
| Attribution UTM multi-touch | Partiel |
| Alertes budget temps réel | Partiel — Beat horaire |

### 9.6 — UI & auth

| Fonctionnalité | État |
| -------------- | ---- |
| Pages module (Social, Ads, SEO, Budget, Agent) | Implémenté |
| JWT auth + workspaces | Implémenté |
| Drag & drop calendrier | À venir |
| Mode mobile responsive | Partiel |

---

## 10. Setup local (Quick Start)

Voir aussi **[README.md](../README.md)** pour le guide condensé.

### Prérequis

- Node.js 20+, Python 3.11+, Docker Compose
- ffmpeg/ffprobe pour le traitement média

### Installation

```bash
cp .env.example .env
# Renseigner MONGODB_URI, REDIS_*, JWT_SECRET, APP_KEY, WORKER_API_SECRET, INTERNAL_API_URL

# Option A — stack complète Docker
docker compose up -d

# Option B — infra seule + dev local
docker compose up -d mongo redis
npm install
npm run dev          # API :4010, Web :3000, Realtime :8000
make worker          # terminal 2
make beat            # terminal 3
```

### Ports

| Service | Port | URL |
| ------- | ---- | --- |
| API Fastify | 4010 | http://localhost:4010 |
| Frontend Next.js | 3000 | http://localhost:3000 |
| SocketCluster | 8000 | ws://localhost:8000 |
| MongoDB | 27017 | mongodb://localhost:27017 |
| Redis | 6379 | redis://localhost:6379 |

### Raccourcis Makefile

```bash
make up      # docker compose up -d
make down    # docker compose down
make dev     # npm run dev
make worker  # Celery worker
make beat    # Celery beat
make check   # syntaxe API + compileall Python
```

### Scripts tunnels OAuth

```bash
./start_with_docker.sh   # Docker + ngrok/cloudflared
./start.sh               # npm local + Celery + tunnels
```

---

## 11. Variables d'environnement

Liste complète : **`.env.example`**.

### Obligatoires (local)

| Variable | Description |
| -------- | ----------- |
| `MONGODB_URI` | URI MongoDB |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | Redis |
| `JWT_SECRET` | Secret JWT |
| `APP_KEY` | Chiffrement `integrations` (32 premiers caractères) |
| `WORKER_API_SECRET` | Auth worker → `/api/internal/worker/*` |
| `INTERNAL_API_URL` | URL API vue par le worker |

### Celery & ads

| Variable | Description |
| -------- | ----------- |
| `CELERY_REDIS_LIST` | Liste Redis pont API → worker (défaut `agentmarket:api_task_bridge`) |
| `LEGACY_API_EXECUTION_ADS` | `0` = ads via Celery (recommandé) |
| `ADS_PACING_AUTO_PAUSE` | Beat : pause auto campagnes en dépassement |
| `ADS_BID_AUTO_APPLY` | Beat : application auto enchères sûres |

### IA (par workspace — pas dans `.env`)

Les clés `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` ne vont **pas** dans `.env`. Les configurer dans l'UI (**Settings → AI**) ; stockage chiffré dans `integrations`.

### OAuth (selon plateformes)

`LINKEDIN_*`, `INSTAGRAM_*`, `TIKTOK_*`, `TWITTER_*`, `META_*`, `GOOGLE_ADS_*` — voir `.env.example`.

---

## 12. Conventions de code

- **Backend Node** : ES Modules, pas de TypeScript
- **Frontend** : Next.js App Router, CSS pur
- **Python** : PEP 8, type hints recommandés
- **Base de données** : driver MongoDB natif (modèles dans `apps/api/src/models/`)
- **Événements** : Redis pub/sub → SocketCluster (`lib/events.js`)
- **Queues** : Celery uniquement — `enqueueCeleryTask()` LPUSH sur `CELERY_REDIS_LIST`, drainé par Beat
- **Publish posts** : worker appelle l'API interne, pas de mutation directe Mongo côté worker pour les posts

---

_Document d'onboarding — à maintenir avec le code (routes, collections, beat schedule)._
