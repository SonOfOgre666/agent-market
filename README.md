# Agent Market

Monorepo **marketing multi-canal** : publication sociale, campagnes publicitaires (Google Ads, Meta), génération IA (Gemini via worker Celery), dashboard Next.js, temps réel SocketCluster.

## Documentation (source de vérité)

| Document | Contenu |
| -------- | ------- |
| **[Rules/ARCHITECTURE_RULES.md](Rules/ARCHITECTURE_RULES.md)** | Règles strictes des couches (API, worker Celery, connecteurs, temps réel). |
| **[Rules/CLEAN_ARCHITECTURE_ROADMAP.md](Rules/CLEAN_ARCHITECTURE_ROADMAP.md)** | Roadmap d’alignement repo (phases P0–P5, persistence, événements, LLM `lib/llm/`). |
| **[docs/ONBOARDING.md](docs/ONBOARDING.md)** | Stack, architecture, **référence détaillée par zone** (API, web, worker, collections Mongo), setup local. |
| **[docs/FILE_INDEX.md](docs/FILE_INDEX.md)** | **Inventaire d’un fichier → une ligne d’explication** pour les chemins importants du dépôt (hors `node_modules`, caches, etc.) — **maintenu à la main**. |
| **[docs/MIGRATION_PLAN.md](docs/MIGRATION_PLAN.md)** | Exécution **Celery-only** : pont Redis, Beat, suppression du worker Node BLPOP. |
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | Vue des composants runtime. |
| **[docs/api_postman_collection.json](docs/api_postman_collection.json)** | Collection Postman pour l’API. |

Le **README** ci-dessous résume le démarrage ; le détail des fichiers et du produit est dans les liens ci-dessus.

---

## Structure du dépôt

| Dossier | Rôle |
| ------- | ---- |
| `apps/web` | Interface **Next.js** (App Router, CSS global). |
| `apps/api` | API **Fastify** : CRUD, auth JWT, enqueue **Celery** via liste Redis `CELERY_REDIS_LIST`. |
| `services/realtime` | **SocketCluster** : relais Redis pub/sub → WebSocket. |
| `services/ai-worker` | **Celery** (worker + logique Beat dans `celery_app.py`) : publish, imports, métriques, Gemini, schedulers. |
| `docs/` | Guides, politiques, index de fichiers, Postman. |
| `scripts/` | Utilitaires (ex. **`get-meta-credentials.js`** Meta). |

---

## Prérequis

- Node.js **20+**
- Python **3.11+**
- Docker + Docker Compose (recommandé)

---

## Quick start

### 1. Environnement

```bash
cp .env.example .env
# Éditer .env : MONGODB_URI, REDIS_*, JWT_SECRET, APP_KEY, GEMINI_API_KEY, clés OAuth…
```

### 2. Infrastructure

```bash
docker compose up -d
```

Lève **MongoDB**, **Redis**, et la stack applicative (**api**, **web**, **realtime**, **celery-worker**, **celery-beat**) selon votre `docker-compose.yml`.

### 3. Dépendances Node

```bash
npm install
npm run dev
```

Lance **API** (:4010), **Web** (:3000), **Realtime** (:8000) (voir `package.json` racine).

### 4. Celery (obligatoire pour publish, imports, `/api/ai/*`)

Renseigner dans **`.env`** au minimum **`WORKER_API_SECRET`** (≥ 8 caractères, ex. `openssl rand -hex 24`) et **`INTERNAL_API_URL`** (`http://127.0.0.1:4010` en local). Sans cela, la publication des posts (`tasks.social.publish_post`) et le beat **`tick_due_posts`** ne peuvent pas appliquer les changements via l’API.

Depuis la **racine** du dépôt :

```bash
make worker
make beat
```

Équivalent manuel (après `python3 -m venv .venv` + `pip install -r requirements.txt` dans `services/ai-worker`) :

```bash
cd services/ai-worker
source .venv/bin/activate
celery -A celery_app:celery_app worker -l info
# autre terminal :
celery -A celery_app:celery_app beat -l info
```

> **`npm run worker` dans `apps/api` est volontairement inop** : l’exécution des jobs se fait uniquement dans **Celery**.

---

## Endpoints utiles

- **API** : `http://localhost:4010/`
- **Santé** : `GET http://localhost:4010/api/health`
- **Web** : `http://localhost:3000`
- **WebSocket** : `ws://localhost:8000` (SocketCluster)

Les routes complètes (souvent sous **`/api`** avec JWT) sont décrites dans **`docs/ONBOARDING.md`** et testables via **`docs/api_postman_collection.json`**.

Exemples historiques (certaines routes peuvent exiger un workspace JWT plutôt que `userId` en query — vérifier le code des routes) :

- Social (collection legacy **`social_posts`** via `routes/social.js`) : draft, schedule, publish-now…
- Posts principaux (**`posts`**) : voir `routes/posts.js` et UI `apps/web/app/posts/`.
- Ads : campagnes, landing pages, leads — `routes/ads.js`.
- Intégrations OAuth : `routes/integrations.js`, callbacks dans `routes/callback.js`.

---

## OAuth — redirect URIs (exemples locaux)

À déclarer chez chaque fournisseur (voir `.env.example` pour les noms exacts de variables) :

- `http://localhost:4010/api/integrations/linkedin/callback`
- `http://localhost:4010/api/integrations/instagram/callback`
- `http://localhost:4010/api/integrations/tiktok/callback`
- `http://localhost:4010/api/integrations/twitter/callback`
- `http://localhost:4010/api/integrations/facebook_page/callback`
- `http://localhost:4010/api/integrations/instagram_login/callback`
- `http://localhost:4010/api/integrations/google-ads/callback`

Flux typique : `GET /api/integrations/:provider/connect` → navigateur → callback → compte dans **`accounts`**.

---

## Temps réel

- Canal Redis : **`EVENTS_CHANNEL`** (défaut `agent_market:events`).
- **`services/realtime`** relaie vers le canal SocketCluster **`events`**.
- Le dashboard consomme les événements via **`apps/web/lib/socket.js`**.

---

## Inventaire des fichiers

Voir **`docs/FILE_INDEX.md`** (tableau maintenu à la main).

---

## Pistes d’évolution (non exhaustif)

1. Étendre **`publish_native.py`** (et flux associés) pour chaque réseau requis en production.
2. Renforcer tests E2E (OAuth, publish, webhooks).
3. Option : passer **`/api/ai/*`** en **202 + polling** côté web pour ne plus bloquer la requête HTTP sur le worker.

Pour l’historique migration Node → Celery, voir **`docs/MIGRATION_PLAN.md`**.
