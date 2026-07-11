# Agent-Market — Guide d'onboarding développeur

> **Dernière mise à jour** : Mars 2026

---

## 1. C'est quoi Agent-Market ?

Agent-Market est une **plateforme de gestion marketing cross-plateforme pilotée par l'IA**. Elle centralise dans une seule « tour de contrôle » :

- La **gestion des réseaux sociaux** (LinkedIn, Instagram, TikTok, Facebook)
- La **gestion des campagnes publicitaires** (Google Ads, SEA)
- L'**optimisation SEO/SEA automatisée par IA**
- Le **suivi budgétaire** et des **KPIs en temps réel**

L'objectif : automatiser toute la chaîne marketing — de la génération de contenu à l'optimisation des campagnes — via des agents IA connectés aux APIs des plateformes.

---

## 2. Stack technique

### Frontend (`apps/web`)

| Techno | Version | Rôle |
| ------ | ------- | ---- |
| **Next.js** | 15.1.0 | Framework React SSR/SSG, routing, pages dynamiques |
| **React** | 19.0.0 | UI components |
| **SocketCluster Client** | 20.x | Connexion WebSocket temps réel |
| **CSS pur** | — | Pas de Tailwind ni framework CSS, tout est dans `globals.css` |

### Backend API (`apps/api`)

| Techno | Version | Rôle |
| ------ | ------- | ---- |
| **Fastify** | 5.1.0 | API REST haute performance |
| **MongoDB** (driver natif) | 6.12.0 | Base de données principale (pas Mongoose) |
| **ioredis** | 5.4.1 | Cache, queues, pub/sub événements |
| **dotenv** | 16.4.5 | Variables d'environnement |

### Temps réel (`services/realtime`)

| Techno | Version | Rôle |
| ------ | ------- | ---- |
| **SocketCluster Server** | 20.x | WebSocket bidirectionnel, broadcast d'événements |
| **ioredis** | 5.4.1 | Souscription Redis pub/sub → relay vers les clients WS |

### AI Worker (`services/ai-worker`)

| Techno | Version | Rôle |
| ------ | ------- | ---- |
| **Python** | 3.11+ | Runtime worker |
| **Celery** | 5.4.0 | File d'attente de tâches asynchrones |
| **Redis** | 5.1.1 | Broker Celery |
| **OpenAI SDK** | 1.68.2 | Génération de contenu, assets, analyse sémantique |
| **Anthropic SDK** | 0.49.0 | Alternative IA (Claude) |
| **PyMongo** | 4.10.1 | Accès MongoDB depuis Python |
| **Requests** | 2.32.3 | Appels HTTP (LinkedIn API, etc.) |

### Infrastructure

| Techno | Rôle |
| ------ | ---- |
| **MongoDB 7** | Source de vérité (campagnes, posts, leads, métriques) |
| **Redis 7** | Queue Celery + cache + event bridge (pub/sub) |
| **Docker Compose** | Orchestration MongoDB + Redis en local |

---

## 3. Architecture du projet

```
Agent-Market/
├── .env                    # Variables d'env (SECRETS — jamais commiter)
├── .env.example            # Template des variables requises
├── docker-compose.yml      # MongoDB + Redis
├── Makefile                # Raccourcis: up, down, dev, worker
├── package.json            # Monorepo npm workspaces
├── apps/
│   ├── api/                # API Fastify (port 4010)
│   │   └── src/
│   │       ├── index.js    # Point d'entrée, registration des routes
│   │       ├── lib/
│   │       │   ├── mongo.js    # Singleton MongoClient
│   │       │   ├── redis.js    # Singleton Redis (ioredis)
│   │       │   └── events.js   # Helper : publish event Redis + log MongoDB
│   │       └── routes/
│   │           ├── health.js         # GET /api/health
│   │           ├── social.js         # CRUD posts sociaux, scheduling, publication
│   │           ├── ads.js            # Campagnes, keywords, landing pages, leads, optimization
│   │           ├── integrations.js # OAuth LinkedIn/Instagram/TikTok/Google Ads
│   │           └── dashboard.js      # GET /api/dashboard/overview (KPIs agrégés)
│   └── web/                # Frontend Next.js (port 3000)
│       └── app/
│           ├── page.js         # Dashboard principal
│           ├── layout.js       # Layout HTML racine
│           ├── globals.css     # Styles globaux
│           ├── components/
│           │   └── LivePanel.js    # Widget temps réel (stats + event feed via WS)
│           └── lp/[slug]/
│               ├── page.js             # Landing page dynamique (SSR)
│               ├── LeadCaptureForm.js    # Formulaire de capture de leads
│               └── not-found.js          # 404 landing page
├── services/
│   ├── realtime/           # SocketCluster (port 8000)
│   │   └── server.js       # Subscribe Redis → broadcast WS aux clients
│   └── ai-worker/          # Python Celery
│       ├── celery_app.py       # Config Celery + beat_schedule (cron tasks)
│       ├── requirements.txt    # Dépendances Python
│       ├── connectors/
│       │   ├── google_ads.py   # Connector Google Ads (fallback mode actuellement)
│       │   └── linkedin.py     # Connector LinkedIn (publication de posts)
│       ├── tasks/
│       │   ├── social.py       # Tâches : draft AI, publish scheduled, publish queue
│       │   └── ads.py          # Tâches : keyword research, generate assets, landing pages, optimize
│       └── prompts/            # (vide — à remplir avec les prompts IA)
└── docs/
    ├── ARCHITECTURE.md     # Vue d'ensemble architecture
    └── ONBOARDING.md       # Ce fichier
```

---

## 4. Flux de données

```
Utilisateur (Dashboard Next.js)
        │
        ▼
   API Fastify ──────── MongoDB (persist)
        │
        ├── redis.lpush(queue:*) ──► Celery Worker (Python)
        │                                    │
        │                                    ├── OpenAI / Anthropic (génération)
        │                                    ├── Google Ads API
        │                                    ├── LinkedIn API
        │                                    └── MongoDB (résultats)
        │
        └── redis.publish(events) ──► SocketCluster ──► Dashboard (live update)
```

1. L'utilisateur déclenche une action depuis le dashboard
2. L'API Fastify persiste le job dans MongoDB
3. L'API enqueue une tâche Celery via Redis
4. Le worker Python exécute le job IA et stocke le résultat en MongoDB
5. Le worker émet un événement Redis pub/sub
6. SocketCluster relay l'événement aux clients WebSocket
7. Le dashboard se met à jour en temps réel

---

## 5. Collections MongoDB

| Collection | Contenu |
| ---------- | ------- |
| **`social_posts`** | Posts sociaux (draft, scheduled, published, queued) |
| **`social_connections`** | Tokens OAuth par provider (LinkedIn, Instagram, TikTok, Google Ads) |
| **`ads_campaigns`** | Campagnes publicitaires (budget, keywords, assets, landing pages) |
| **`ads_keyword_research`** | Historique de recherches de mots-clés |
| **`ads_leads`** | Leads capturés via les landing pages (avec UTM tracking) |
| **`ads_metrics`** | Métriques de performance par campagne (CTR, CPC, ROI, ROAS) |
| **`event_logs`** | Journal d'événements (audit trail) |

---

## 6. Intégrations plateformes (OAuth)

| Plateforme | Statut | Endpoints |
| ---------- | ------ | --------- |
| **LinkedIn** | Connecteur + OAuth fonctionnels | `/api/integrations/linkedin/connect`, `callback`, `urn`, `status` |
| **Instagram (Meta)** | OAuth wired, tokens à configurer | `/api/integrations/instagram/connect`, `callback` |
| **TikTok** | OAuth wired, tokens à configurer | `/api/integrations/tiktok/connect`, `callback` |
| **Google Ads** | OAuth + worker Celery (API Google Ads réelle) | `/api/accounts` + agent tools `google_*` |
| **Facebook / Meta** | OAuth + publish Graph API | `/api/accounts` |

**Diagnostic complet** : `GET /api/integrations/diagnostics`

---

## 7. API Endpoints (canonical)

### Social (workspace JWT)

| Méthode | Route | Description |
| ------- | ----- | ----------- |
| `GET/POST/PATCH` | `/api/posts` | Posts CRUD (collection `posts`) |
| `POST` | `/api/posts/:id/publish` | Publier via Celery `tasks.social.publish_post` |
| `POST` | `/api/posts/:id/schedule` | Planifier un post |
| `POST` | `/api/posts/comments/analyze` | Analyser un commentaire (LLM) |

### SEO & calendrier éditorial

| Méthode | Route | Description |
| ------- | ----- | ----------- |
| `POST` | `/api/seo/keywords/cluster` | Clustering de mots-clés |
| `POST` | `/api/seo/keywords/check-ranks` | Suivi SERP |
| `GET` | `/api/seo/landing-pages/audit` | Audit SEO landing pages |
| `POST` | `/api/calendar/suggestions/generate` | Suggestions calendrier IA |
| `POST` | `/api/ads/competitive-analysis` | Analyse concurrentielle |

### Ads (Google Ads + Meta)

| Méthode | Route | Description |
| ------- | ----- | ----------- |
| `POST` | `/api/ads/keywords/suggest` | Suggestion de mots-clés (LLM + Keyword Planner) |
| `POST` | `/api/ads/campaigns` | Créer une campagne |
| `GET` | `/api/ads/campaigns` | Lister les campagnes |
| `POST` | `/api/ads/campaigns/:id/generate-assets` | Générer les assets (titres, descriptions) |
| `POST` | `/api/ads/campaigns/:id/generate-landing-page` | Générer une landing page |
| `POST` | `/api/ads/campaigns/:id/optimize` | Analyse KPI + suggestions (même logique que Budget) |
| `POST` | `/api/ads/budget/pacing` | Analyse pacing budgétaire |
| `POST` | `/api/ads/budget/reallocation` | Recommandations de réallocation |
| `POST` | `/api/ads/optimization/bid` | Recommandations d'enchères CPA/ROAS |
| `GET` | `/api/ads/optimization/quality-score` | Monitoring Quality Score |
| `POST` | `/api/ads/optimization/asset-ab` | Analyse A/B des annonces |
| `GET` | `/api/ads/reports/kpi-pdf` | Rapport KPI PDF |
| `POST` | `/api/ads/negative-keywords/suggest` | Suggestions de mots-clés négatifs |
| `GET` | `/api/ads/landing-pages` | Lister les landing pages |
| `GET` | `/api/ads/landing-pages/:slug` | Voir une landing page |
| `POST` | `/api/ads/landing-pages/:slug/lead` | Capturer un lead (avec UTM) |
| `GET` | `/api/ads/leads` | Lister les leads |

### Dashboard

| Méthode | Route | Description |
| ------- | ----- | ----------- |
| `GET` | `/api/dashboard` | KPIs workspace (posts + ads + leads) |

---

## 8. Celery Beat (tâches planifiées)

| Tâche | Fréquence | Rôle |
| ----- | --------- | ---- |
| `scheduler.tick_due_posts` | Chaque 60s | Publie les posts planifiés (`tasks.social.publish_post`) |
| `scheduler.tick_due_campaigns` | Chaque 60s | Publie les campagnes ads planifiées |
| `generate-content-suggestions` | Quotidien 07:00 UTC | Suggestions calendrier IA par workspace actif |
| `optimize-active-campaigns` | Chaque heure :30 | Optimisation KPI (service `runCampaignOptimization`) |
| `scheduler.hourly_budget_pacing` | Chaque heure :15 | Pacing budgétaire workspace |
| `scheduler.hourly_bid_optimization` | Chaque heure :45 | Recommandations d'enchères CPA/ROAS |
| `scheduler.daily_negative_keyword_review` | Quotidien 07:30 UTC | Revue search terms → negatives |
| `scheduler.weekly_report_monday_8utc` | Lundi 08:00 UTC | Snapshots rapport KPI |
| `scheduler.ads_platform_sync_daily` | Quotidien 06:00 UTC | Sync Google/Meta campagnes |

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
| Suivi positions SERP | Implémenté (scrape DuckDuckGo — pas d'API SERP payante) |
| Audit landing pages | Partiel — règles Mongo, pas de crawl live |
| Crawl technique complet (CWV, sitemap, liens) | À venir |

### 9.4 — IA & contenu

| Fonctionnalité | État |
| -------------- | ---- |
| Calendrier éditorial IA | Implémenté |
| RSA / landing page copy | Implémenté (LLM requis) |
| Analyse concurrentielle | Implémenté |
| Génération visuels DALL-E | Partiel — via `generate_image` agent |

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

### Prérequis

- Node.js 20+
- Python 3.11+
- Docker + Docker Compose

### Installation

```bash
# 1. Cloner et entrer dans le projet
cd Agent-Market

# 2. Copier les variables d'environnement
cp .env.example .env
# → Remplir les clés API dans .env

# 3. Lancer MongoDB + Redis
docker compose up -d

# 4. Installer les dépendances Node (monorepo)
npm install

# 5. Lancer les 3 services Node (API + Web + Realtime)
npm run dev
# ou individuellement :
# npm run dev:api → http://localhost:4010
# npm run dev:web → http://localhost:3000
# npm run dev:realtime → ws://localhost:8000

# 6. Installer les dépendances Python
cd services/ai-worker
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 7. Lancer le worker Celery
celery -A celery_app.celery_app worker -l info

# 8. Lancer le scheduler Celery Beat (dans un autre terminal)
celery -A celery_app.celery_app beat -l info
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
make dev     # npm run dev (tous les services Node)
make worker  # lance le Celery worker
```

---

## 11. Variables d'environnement requises

Voir `.env.example` pour la liste complète. Les principales :

| Variable | Description |
| -------- | ----------- |
| `MONGO_URL` | URL MongoDB |
| `REDIS_URL` | URL Redis |
| `API_PORT` | Port API (défaut: 4010) |
| `SC_PORT` | Port SocketCluster (défaut: 8000) |
| `OPENAI_API_KEY` | Clé OpenAI pour la génération IA |
| `ANTHROPIC_API_KEY` | Clé Anthropic (Claude) |
| `LINKEDIN_CLIENT_ID` / `SECRET` | OAuth LinkedIn |
| `INSTAGRAM_APP_ID` / `SECRET` | OAuth Instagram (Meta) |
| `TIKTOK_CLIENT_KEY` / `SECRET` | OAuth TikTok |
| `GOOGLE_ADS_*` | Credentials Google Ads |

---

## 12. Conventions de code

- **Backend Node** : ES Modules (`import`/`export`), pas de TypeScript
- **Frontend** : Next.js App Router, CSS pur (pas de framework CSS)
- **Python** : PEP 8, type hints recommandés
- **Base de données** : MongoDB driver natif (pas d'ODM type Mongoose)
- **Événements** : tout passe par Redis pub/sub → SocketCluster
- **Queues** : jobs Celery via Redis broker (`enqueueCeleryTask` / `send_task`) — pas de drainers Redis list séparés

---

_Document généré pour l'onboarding — à maintenir à jour au fur et à mesure de l'avancement du projet._
