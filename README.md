# Agent Market

Plateforme **marketing multi-canal pilotée par l'IA** : réseaux sociaux, campagnes publicitaires (Google Ads, Meta), SEO, agent IA conversationnel, génération de contenu (LLM via worker Celery), dashboard Next.js et temps réel SocketCluster.

Chaque utilisateur travaille dans un **workspace** (JWT). Les clés IA (Gemini, OpenAI, Anthropic) se configurent **par workspace** dans l'interface web — pas dans `.env`.

--- 

## Documentation

| Document | Contenu |
| -------- | ------- |
| **[docs/ONBOARDING.md](docs/ONBOARDING.md)** | Stack, architecture, collections MongoDB, endpoints API, état d'avancement des fonctionnalités, setup local détaillé. |
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | Vue des composants runtime et flux de données. |

Le **README** ci-dessous résume le produit et le démarrage. Le détail API, worker et collections est dans **ONBOARDING**.

---

## Fonctionnalités (aperçu)

| Module | Web (`apps/web/app/`) | API (`apps/api/src/routes/`) | Worker Celery (`services/ai-worker/tasks/`) |
| ------ | --------------------- | ---------------------------- | ------------------------------------------- |
| **Auth & workspaces** | `login`, `register`, `team` | `auth.js`, `workspace.js` | — |
| **Posts sociaux** | `posts/`, `calendar/` | `posts.js`, `calendar.js` | `social/` (publish, schedule, comments) |
| **Comptes & OAuth** | `accounts/`, `integrations/` | `accounts.js`, `integrations.js`, `callback.js` | `imports/` (followers, insights, media) |
| **Médias** | `media/` | `media.js` | — |
| **Ads (Google + Meta)** | `ads/` (campagnes, perf, leads, landing pages) | `ads.js` | `ads/` (publish, sync, reporting, tools) |
| **SEO** | `seo/` | `seo.js` | `seo/` (cluster, rank check, audit) |
| **Agent IA** | `agent/` | `agent.js` | `agent/` (plan, execute workflow) |
| **IA synchrone** | `ai-providers/`, `ai-integrations/` | `ai.js`, `aiWorkspace.js` | `ai/` (gemini_sync) |
| **Budget & rapports** | `budget/`, `reports/` | `ads.js`, `reports.js`, `dashboard.js` | schedulers Beat |
| **Landing pages** | `landing-pages/`, `lp/[slug]/` | `ads.js` | — |
| **Leads** | `leads/` | `ads.js` | — |
| **Paramètres** | `profile/`, `preferences/` | `profile.js`, `settings.js`, `system.js` | — |
| **Commentaires sociaux** | (dans posts) | `socialComments.js` | `social/analyze_post_comment`, `reply_to_comment` |
| **Temps réel** | dashboard, `RealtimeProvider` | `lib/events.js` | événements via Redis pub/sub |

Diagnostic intégrations : `GET /api/integrations/diagnostics` (JWT workspace).

---

## Structure du dépôt

| Dossier / fichier | Rôle |
| ----------------- | ---- |
| `apps/web` | Interface **Next.js 15** (App Router, CSS global). |
| `apps/api` | API **Fastify** : CRUD, auth JWT, enqueue **Celery** via liste Redis `CELERY_REDIS_LIST`. |
| `services/realtime` | **SocketCluster** : relais Redis pub/sub → WebSocket. |
| `services/ai-worker` | **Celery** (worker + Beat dans `celery_app.py`) : publish, imports, métriques, LLM, schedulers. |
| `docs/` | Guides développeur (`ONBOARDING.md`, `ARCHITECTURE.md`). |
| `scripts/` | Utilitaires (ex. `get-meta-credentials.js` pour Meta). |
| `start.sh` | Démarrage local complet sans Docker app (npm + Celery + proxy + ngrok — un seul domaine public pour web/API/realtime). |
| `start_with_docker.sh` | `docker compose up -d` + tunnels pour callbacks OAuth distants. |
| `Makefile` | Raccourcis : `up`, `down`, `dev`, `worker`, `beat`, `check`. |
| `UML/` | Diagrammes PlantUML (architecture, séquences). |
| `.github/workflows/` | Pipeline **CI/CD** (tests, build Docker, publication GHCR). |

---

## Prérequis

- Node.js **20+**
- Python **3.11+** (CI utilise **3.12**)
- Docker + Docker Compose (recommandé)
- **ffmpeg** / **ffprobe** (traitement média, voir `.env.example`)

---

## Quick start

### 1. Environnement

```bash
cp .env.example .env
```

Variables **obligatoires** en local :

| Variable | Rôle |
| -------- | ---- |
| `MONGODB_URI` | MongoDB (local Docker ou Atlas) |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | Redis (broker Celery + cache + événements) |
| `JWT_SECRET` | Auth API (ex. `openssl rand -base64 48`) |
| `APP_KEY` | Chiffrement config services (32 premiers caractères ; identique côté worker) |
| `WORKER_API_SECRET` | Secret worker → API (ex. `openssl rand -hex 24`) |
| `INTERNAL_API_URL` | URL API vue par le worker (`http://127.0.0.1:4010` en local ; `http://api:4010` en Docker) |

Variables **OAuth** selon les plateformes à connecter : voir section [OAuth](#oauth--redirect-uris-exemples-locaux) et `.env.example`.

> **IA :** ne pas mettre `GEMINI_API_KEY`, `OPENAI_API_KEY` ou `ANTHROPIC_API_KEY` dans `.env`. Les configurer dans l'UI : **Settings → AI** (par workspace).

### 2. Infrastructure

**Stack complète en Docker** (MongoDB, Redis, api, web, realtime, celery-worker, celery-beat) :

```bash
docker compose up -d
```

**Infra seule** (Mongo + Redis) pour développer l'app en local avec `npm run dev` :

```bash
docker compose up -d mongo redis
```

### 3. Dépendances Node

```bash
npm install
npm run dev
```

Lance **API** (:4010), **Web** (:3000), **Realtime** (:8000) (voir `package.json` racine).

### 4. Celery (obligatoire pour publish, imports, `/api/ai/*`, agent)

Sans **`WORKER_API_SECRET`** + **`INTERNAL_API_URL`**, la publication des posts (`tasks.social.publish_post`) et le beat `tick_due_posts` échouent.

**Avec Docker** : `celery-worker` et `celery-beat` sont déjà dans `docker compose up -d`.

**Sans Docker app** — depuis la racine :

```bash
make worker
make beat
```

Équivalent manuel :

```bash
cd services/ai-worker
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
celery -A celery_app:celery_app worker -l info
# autre terminal :
celery -A celery_app:celery_app beat -l info
```

> L'exécution des jobs se fait **uniquement dans Celery** (pas de worker Node BLPOP).

### 5. Scripts de démarrage (optionnel)

Pour OAuth avec un domaine public (ngrok) :

```bash
./start_with_docker.sh   # Docker stack + tunnels
./start.sh               # npm local + Celery + tunnels (Mongo/Redis requis)
```

Voir les commentaires en tête de chaque script pour les prérequis.

### 6. Vérification locale

```bash
make check   # syntaxe JS API + compileall Python worker
```

Tests worker (équivalent CI `worker-tests`) :

```bash
cd services/ai-worker
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt pytest
python -m pytest tests/ -q --ignore=tests/test_competitive_intel.py
```

---

## CI/CD

Le workflow **`.github/workflows/ci.yml`** s'exécute sur chaque **push** vers `main` / `master`, sur les **tags** `v*`, et sur les **pull requests**.

| Job | Rôle |
| --- | ---- |
| **`api-syntax`** | `node --check` sur tous les fichiers `apps/api/src/**/*.js` |
| **`worker-tests`** | `pytest` dans `services/ai-worker` (hors `test_competitive_intel.py`) |
| **`docker`** | Build des 4 images Docker (matrix : `api`, `web`, `realtime`, `ai-worker`) |

Comportement :

- **Pull request** : build des images uniquement (pas de push).
- **Push sur `main`** : build **et publication** sur **GitHub Container Registry (GHCR)**.
- **Tag `v*`** : publication avec tag semver en plus de `latest` et du SHA.

| Service | Image GHCR |
| ------- | ---------- |
| API | `ghcr.io/sonofogre666/agent-market-api` |
| Web | `ghcr.io/sonofogre666/agent-market-web` |
| Realtime | `ghcr.io/sonofogre666/agent-market-realtime` |
| Worker Celery | `ghcr.io/sonofogre666/agent-market-ai-worker` |

Variables optionnelles (repo → **Settings → Secrets and variables → Actions → Variables**) pour le build Next.js : `NEXT_PUBLIC_API_URL`, `NEXT_REWRITE_API_URL`, `NEXT_PUBLIC_SC_HOST`, `NEXT_PUBLIC_SC_PORT`, `NEXT_PUBLIC_SC_SECURE`.

---

## Déploiement (images GHCR)

1. Copier et configurer **`.env`** (voir Quick start §1).
2. S'authentifier sur GHCR :

```bash
docker login ghcr.io
```

3. Tirer et démarrer :

```bash
docker compose -f docker-compose.yml -f docker-compose.prebuilt.yml pull
docker compose -f docker-compose.yml -f docker-compose.prebuilt.yml up -d
```

Épingler une version : `IMAGE_TAG=<sha> docker compose -f docker-compose.yml -f docker-compose.prebuilt.yml pull up -d`.

Le fichier **`docker-compose.prebuilt.yml`** remplace les blocs `build:` par les images GHCR.

> La CI ne déploie pas automatiquement sur un serveur distant.

---

## Endpoints utiles

| Service | URL |
| ------- | --- |
| API | `http://localhost:4010/` |
| Santé | `GET http://localhost:4010/api/health` |
| Web | `http://localhost:3000` |
| WebSocket | `ws://localhost:8000` (SocketCluster) |

### Routes API (JWT workspace sauf auth / callbacks / health)

Enregistrées dans `apps/api/src/registerRoutes.js` :

| Préfixe / fichier | Domaine |
| ---------------- | ------- |
| `auth.js` | Inscription, connexion, tokens |
| `workspace.js` | Membres, invitations |
| `posts.js` | CRUD posts, publish, schedule |
| `accounts.js` | Comptes connectés (social + ads) |
| `integrations.js` | OAuth connect (LinkedIn, Instagram, TikTok, Google Ads) |
| `callback.js` | Callbacks OAuth (`/callback/*`), webhooks Meta |
| `ads.js` | Campagnes, keywords, landing pages, leads, budget, reporting |
| `seo.js` | Clustering keywords, rank check, audit landing |
| `agent.js` | Agent IA, workflows |
| `ai.js`, `aiWorkspace.js` | Exécution IA synchrone (Celery round-trip) |
| `calendar.js` | Suggestions calendrier éditorial |
| `media.js` | Upload / bibliothèque média |
| `socialComments.js` | Commentaires, analyse LLM |
| `dashboard.js`, `reports.js` | KPIs, rapports |
| `settings.js`, `profile.js`, `system.js` | Préférences, config workspace |
| `worker_internal.js` | Endpoints internes worker → API (`WORKER_API_SECRET`) |

Liste détaillée des endpoints : **`docs/ONBOARDING.md` §7**.

---

## OAuth — redirect URIs (exemples locaux)

À déclarer chez chaque fournisseur (noms de variables dans `.env.example`) :

| Plateforme | URI locale typique |
| ---------- | ------------------ |
| LinkedIn | `http://localhost:4010/api/integrations/linkedin/callback` |
| Instagram (Meta) | `http://localhost:4010/api/integrations/instagram/callback` |
| TikTok | `http://localhost:4010/api/integrations/tiktok/callback` |
| Twitter/X | `http://localhost:4010/api/integrations/twitter/callback` |
| Facebook Page | `http://localhost:4010/api/integrations/facebook_page/callback` |
| Instagram Login | `http://localhost:4010/api/integrations/instagram_login/callback` |
| Google Ads (intégrations) | `http://localhost:4010/api/integrations/google-ads/callback` |
| Google Ads (comptes) | `http://localhost:4010/callback/google_ads` (`GOOGLE_ADS_CALLBACK_URL`) |
| Meta Ads | `http://localhost:4010/callback/meta_ads` |

Flux typique : `GET /api/integrations/:provider/connect` → navigateur → callback → compte dans collection **`accounts`**.

Pour les callbacks distants (tunnel), utiliser `start.sh` / `start_with_docker.sh` ou ajuster `NEXT_PUBLIC_API_URL` et les URIs chez le fournisseur.

---

## Temps réel

- Canal Redis : **`EVENTS_CHANNEL`** (défaut `agent_market:events`).
- **`services/realtime`** relaie vers le canal SocketCluster **`events`**.
- Le dashboard consomme les événements via **`apps/web/lib/socket.js`** et **`RealtimeProvider`**.

---

## Pistes d'évolution (non exhaustif)

1. Étendre **`publish_native.py`** pour chaque réseau requis en production.
2. Renforcer tests E2E (OAuth, publish, webhooks).
3. Passer **`/api/ai/*`** en **202 + polling** côté web pour ne plus bloquer la requête HTTP sur le worker.
4. Compléter crawl SEO live (au-delà des règles Mongo actuelles).

État d'avancement détaillé : **`docs/ONBOARDING.md` §9**.
