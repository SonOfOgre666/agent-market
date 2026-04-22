# Agent-Market — Guide d'onboarding développeur

> **Dernière mise à jour** : Mars 2026

---

## 1. C'est quoi Agent-Market ?

Agent-Market est une **plateforme de gestion marketing cross-plateforme pilotée par l'IA**. Elle centralise dans une seule "tour de contrôle" :

- La **gestion des réseaux sociaux** (LinkedIn, Instagram, TikTok, Facebook)
- La **gestion des campagnes publicitaires** (Google Ads, SEA)
- L'**optimisation SEO/SEA automatisée** par IA
- Le **suivi budgétaire** et des **KPIs en temps réel**

L'objectif : automatiser toute la chaîne marketing — de la génération de contenu à l'optimisation des campagnes — via des agents IA connectés aux APIs des plateformes.

---

## 2. Stack technique

### Frontend (apps/web)

| Techno                   | Version | Rôle                                                          |
| ------------------------ | ------- | ------------------------------------------------------------- |
| **Next.js**              | 15.1.0  | Framework React SSR/SSG, routing, pages dynamiques            |
| **React**                | 19.0.0  | UI components                                                 |
| **SocketCluster Client** | 20.x    | Connexion WebSocket temps réel                                |
| **CSS pur**              | —       | Pas de Tailwind ni framework CSS, tout est dans `globals.css` |

### Backend API (apps/api)

| Techno                     | Version | Rôle                                      |
| -------------------------- | ------- | ----------------------------------------- |
| **Fastify**                | 5.1.0   | API REST haute performance                |
| **MongoDB** (driver natif) | 6.12.0  | Base de données principale (pas Mongoose) |
| **ioredis**                | 5.4.1   | Cache, queues, pub/sub événements         |
| **dotenv**                 | 16.4.5  | Variables d'environnement                 |

### Temps réel (services/realtime)

| Techno                   | Version | Rôle                                                   |
| ------------------------ | ------- | ------------------------------------------------------ |
| **SocketCluster Server** | 20.x    | WebSocket bidirectionnel, broadcast d'événements       |
| **ioredis**              | 5.4.1   | Souscription Redis pub/sub → relay vers les clients WS |

### AI Worker (services/ai-worker)

| Techno            | Version | Rôle                                              |
| ----------------- | ------- | ------------------------------------------------- |
| **Python**        | 3.11+   | Runtime worker                                    |
| **Celery**        | 5.4.0   | File d'attente de tâches asynchrones              |
| **Redis**         | 5.1.1   | Broker Celery                                     |
| **OpenAI SDK**    | 1.68.2  | Génération de contenu, assets, analyse sémantique |
| **Anthropic SDK** | 0.49.0  | Alternative IA (Claude)                           |
| **PyMongo**       | 4.10.1  | Accès MongoDB depuis Python                       |
| **Requests**      | 2.32.3  | Appels HTTP (LinkedIn API, etc.)                  |

### Infrastructure

| Techno             | Rôle                                                  |
| ------------------ | ----------------------------------------------------- |
| **MongoDB 7**      | Source de vérité (campagnes, posts, leads, métriques) |
| **Redis 7**        | Queue Celery + cache + event bridge (pub/sub)         |
| **Docker Compose** | Orchestration MongoDB + Redis en local                |

---

## 3. Architecture du projet

```
Agent-Market/
├── .env                        # Variables d'env (SECRETS — jamais commiter)
├── .env.example                # Template des variables requises
├── docker-compose.yml          # MongoDB + Redis
├── Makefile                    # Raccourcis: up, down, dev, worker
├── package.json                # Monorepo npm workspaces
│
├── apps/
│   ├── api/                    # API Fastify (port 4010)
│   │   └── src/
│   │       ├── index.js        # Point d'entrée, registration des routes
│   │       ├── lib/
│   │       │   ├── mongo.js    # Singleton MongoClient
│   │       │   ├── redis.js    # Singleton Redis (ioredis)
│   │       │   └── events.js   # Helper : publish event Redis + log MongoDB
│   │       └── routes/
│   │           ├── health.js       # GET /api/health
│   │           ├── social.js       # CRUD posts sociaux, scheduling, publication
│   │           ├── ads.js          # Campagnes, keywords, landing pages, leads, optimization
│   │           ├── integrations.js # OAuth LinkedIn/Instagram/TikTok/Google Ads
│   │           └── dashboard.js    # GET /api/dashboard/overview (KPIs agrégés)
│   │
│   └── web/                    # Frontend Next.js (port 3000)
│       └── app/
│           ├── page.js         # Dashboard principal
│           ├── layout.js       # Layout HTML racine
│           ├── globals.css     # Styles globaux
│           ├── components/
│           │   └── LivePanel.js    # Widget temps réel (stats + event feed via WS)
│           └── lp/[slug]/
│               ├── page.js             # Landing page dynamique (SSR)
│               ├── LeadCaptureForm.js  # Formulaire de capture de leads
│               └── not-found.js        # 404 landing page
│
├── services/
│   ├── realtime/               # SocketCluster (port 8000)
│   │   └── server.js           # Subscribe Redis → broadcast WS aux clients
│   │
│   └── ai-worker/              # Python Celery
│       ├── celery_app.py       # Config Celery + beat_schedule (cron tasks)
│       ├── requirements.txt    # Dépendances Python
│       ├── connectors/
│       │   ├── google_ads.py   # Connector Google Ads (fallback mode actuellement)
│       │   └── linkedin.py     # Connector LinkedIn (publication de posts)
│       ├── tasks/
│       │   ├── social.py       # Tâches : draft AI, publish scheduled, publish queue
│       │   └── ads.py          # Tâches : keyword research, generate assets, landing pages, optimize
│       └── prompts/            # (vide — à remplir avec les prompts IA)
│
└── docs/
    ├── ARCHITECTURE.md         # Vue d'ensemble architecture
    └── ONBOARDING.md           # Ce fichier
```

---

## 4. Flux de données

```
Utilisateur (Dashboard Next.js)
        │
        ▼
   API Fastify ──────── MongoDB (persist)
        │
        ├─── redis.lpush(queue:*) ──► Celery Worker (Python)
        │                                    │
        │                                    ├── OpenAI / Anthropic (génération)
        │                                    ├── Google Ads API
        │                                    ├── LinkedIn API
        │                                    └── MongoDB (résultats)
        │
        └─── redis.publish(events) ──► SocketCluster ──► Dashboard (live update)
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

| Collection             | Contenu                                                             |
| ---------------------- | ------------------------------------------------------------------- |
| `social_posts`         | Posts sociaux (draft, scheduled, published, queued)                 |
| `social_connections`   | Tokens OAuth par provider (LinkedIn, Instagram, TikTok, Google Ads) |
| `ads_campaigns`        | Campagnes publicitaires (budget, keywords, assets, landing pages)   |
| `ads_keyword_research` | Historique de recherches de mots-clés                               |
| `ads_leads`            | Leads capturés via les landing pages (avec UTM tracking)            |
| `ads_metrics`          | Métriques de performance par campagne (CTR, CPC, ROI, ROAS)         |
| `event_logs`           | Journal d'événements (audit trail)                                  |

---

## 6. Intégrations plateformes (OAuth)

| Plateforme           | Statut                                     | Endpoints                                                           |
| -------------------- | ------------------------------------------ | ------------------------------------------------------------------- |
| **LinkedIn**         | ✅ Connecteur + OAuth fonctionnels         | `/api/integrations/linkedin/connect`, `callback`, `urn`, `status`   |
| **Instagram** (Meta) | 🔧 OAuth wired, tokens à configurer        | `/api/integrations/instagram/connect`, `callback`                   |
| **TikTok**           | 🔧 OAuth wired, tokens à configurer        | `/api/integrations/tiktok/connect`, `callback`                      |
| **Google Ads**       | 🔧 OAuth wired, connector en fallback mode | `/api/integrations/google-ads/connect`, `callback`, `refresh-token` |
| **Facebook**         | ❌ À implémenter                           | —                                                                   |

**Diagnostic complet** : `GET /api/integrations/diagnostics`

---

## 7. API Endpoints existants

### Social

| Méthode | Route                                   | Description                         |
| ------- | --------------------------------------- | ----------------------------------- |
| POST    | `/api/social/posts/draft`               | Créer un brouillon de post          |
| POST    | `/api/social/posts/schedule`            | Planifier un post                   |
| GET     | `/api/social/posts`                     | Lister les posts                    |
| POST    | `/api/social/posts/:postId/publish-now` | Publier immédiatement               |
| POST    | `/api/social/comments/analyze`          | Analyser un commentaire (sentiment) |

### Ads (Google Ads)

| Méthode | Route                                          | Description                               |
| ------- | ---------------------------------------------- | ----------------------------------------- |
| POST    | `/api/ads/keywords/suggest`                    | Suggestion de mots-clés                   |
| POST    | `/api/ads/campaigns`                           | Créer une campagne                        |
| GET     | `/api/ads/campaigns`                           | Lister les campagnes                      |
| POST    | `/api/ads/campaigns/:id/generate-assets`       | Générer les assets (titres, descriptions) |
| POST    | `/api/ads/campaigns/:id/generate-landing-page` | Générer une landing page                  |
| POST    | `/api/ads/campaigns/:id/optimize`              | Lancer l'optimisation IA                  |
| GET     | `/api/ads/landing-pages`                       | Lister les landing pages                  |
| GET     | `/api/ads/landing-pages/:slug`                 | Voir une landing page                     |
| POST    | `/api/ads/landing-pages/:slug/lead`            | Capturer un lead (avec UTM)               |
| GET     | `/api/ads/leads`                               | Lister les leads                          |

### Dashboard

| Méthode | Route                     | Description                          |
| ------- | ------------------------- | ------------------------------------ |
| GET     | `/api/dashboard/overview` | KPIs agrégés (social + ads + events) |

---

## 8. Celery Beat (tâches planifiées)

| Tâche                                | Fréquence  | Rôle                                          |
| ------------------------------------ | ---------- | --------------------------------------------- |
| `social.process_due_scheduled_posts` | Chaque 60s | Publie les posts planifiés arrivés à échéance |
| `social.process_redis_publish_queue` | Chaque 20s | Traite la queue de publication immédiate      |
| `ads.process_assets_queue`           | Chaque 20s | Génère les assets des campagnes en queue      |
| `ads.process_landing_page_queue`     | Chaque 20s | Génère les landing pages en queue             |
| `ads.process_optimization_queue`     | Chaque 20s | Lance l'optimisation des campagnes en queue   |

---

## 9. Ce qui reste à construire

### 9.1 — Connecteurs réseaux sociaux complets

- [ ] **Facebook Pages** : OAuth, publication de posts, analyse de commentaires
- [ ] **Instagram** : Publication via Graph API (images, reels, stories)
- [ ] **TikTok** : Upload et publication de vidéos via TikTok Content API
- [ ] **LinkedIn** : Support images/vidéos (actuellement texte seulement)
- [ ] Unification multi-canal : un seul post → publication simultanée sur toutes les plateformes

### 9.2 — Google Ads complet

- [ ] Intégration complète de l'API Google Ads (remplacer les stubs/fallback actuels)
- [ ] Création automatique de campagnes Search/Display via API
- [ ] Gestion des enchères (bidding strategies)
- [ ] Reporting automatisé depuis Google Ads API
- [ ] Sync bidirectionnelle métriques Google Ads ↔ base locale

### 9.3 — Stratégie SEO pilotée par IA

- [ ] **Analyse sémantique** : crawler les pages existantes, extraire les entités, scorer la pertinence sémantique
- [ ] **Génération de mots-clés** : clustering de keywords par intention (informationnel, transactionnel, navigationnel), analyse de la concurrence SERP
- [ ] **Génération de contenu** : articles de blog, meta descriptions, titres H1/H2 optimisés, FAQ structurées (Schema.org)
- [ ] **Génération de pages** : création automatique de landing pages SEO-friendly à partir d'un cluster de keywords
- [ ] **Audit technique SEO** : vérification des balises meta, sitemap, robots.txt, Core Web Vitals, liens cassés
- [ ] **Suivi de positions** : tracker les rankings Google pour les mots-clés cibles
- [ ] **Optimisation continue** : boucle IA qui analyse les performances → propose des améliorations → applique automatiquement

### 9.4 — Stratégie SEA pilotée par IA

- [ ] Optimisation automatique des enchères basée sur les KPIs (CPA cible, ROAS cible)
- [ ] A/B testing automatique des assets publicitaires (titres, descriptions, visuels)
- [ ] Allocation dynamique du budget entre campagnes selon la performance
- [ ] Génération de negative keywords automatique basée sur le query report
- [ ] Script de Quality Score monitoring et recommandations

### 9.5 — Module IA avancé

- [ ] **Prompts structurés** : remplir `services/ai-worker/prompts/` avec les templates de prompts pour chaque tâche
- [ ] **Génération de visuels** : intégrer DALL-E ou Midjourney API pour créer les visuels de posts/ads
- [ ] **Analyse de commentaires** : remplacer le regex basique par un vrai modèle de sentiment analysis (OpenAI / fine-tuned)
- [ ] **Content calendar IA** : proposition automatique d'un calendrier éditorial basé sur les tendances et la saisonnalité
- [ ] **Copywriting IA** : génération de variations de copy pour les annonces (RSA Google Ads)
- [ ] **Analyse concurrentielle** : scraping + analyse IA des stratégies concurrentes

### 9.6 — Suivi budgétaire et KPIs

- [ ] **Dashboard budgétaire** : vue consolidée des dépenses par plateforme (Google Ads, Facebook Ads, LinkedIn Ads)
- [ ] **Alertes budget** : notifications quand un budget approche sa limite ou quand un KPI dévie
- [ ] **Rapports automatiques** : génération de rapports PDF/email hebdomadaires avec les KPIs clés
- [ ] **KPIs trackés** :
  - CTR (Click-Through Rate)
  - CPC (Cost Per Click)
  - CPA (Cost Per Acquisition)
  - ROAS (Return On Ad Spend)
  - ROI global
  - Taux de conversion par landing page
  - Coût par lead
  - Budget consommé vs. budget alloué
  - Quality Score moyen (Google Ads)
- [ ] **Comparaisons temporelles** : semaine vs semaine, mois vs mois
- [ ] **Attribution multi-touch** : tracker le parcours complet du lead (UTM → landing page → conversion)

### 9.7 — UI Dashboard

- [ ] Page dédiée par module (Social, Ads, SEO, Budget)
- [ ] Graphiques de performance (charts CTR, ROI, budget dans le temps)
- [ ] Calendrier éditorial visuel (drag & drop)
- [ ] Gestion multi-utilisateurs / multi-comptes
- [ ] Authentification (JWT ou OAuth)
- [ ] Mode mobile responsive

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
# npm run dev:api      → http://localhost:4010
# npm run dev:web      → http://localhost:3000
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

| Service          | Port  | URL                       |
| ---------------- | ----- | ------------------------- |
| API Fastify      | 4010  | http://localhost:4010     |
| Frontend Next.js | 3000  | http://localhost:3000     |
| SocketCluster    | 8000  | ws://localhost:8000       |
| MongoDB          | 27017 | mongodb://localhost:27017 |
| Redis            | 6379  | redis://localhost:6379    |

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

| Variable                    | Description                       |
| --------------------------- | --------------------------------- |
| `MONGO_URL`                 | URL MongoDB                       |
| `REDIS_URL`                 | URL Redis                         |
| `API_PORT`                  | Port API (défaut: 4010)           |
| `SC_PORT`                   | Port SocketCluster (défaut: 8000) |
| `OPENAI_API_KEY`            | Clé OpenAI pour la génération IA  |
| `ANTHROPIC_API_KEY`         | Clé Anthropic (Claude)            |
| `LINKEDIN_CLIENT_ID/SECRET` | OAuth LinkedIn                    |
| `INSTAGRAM_APP_ID/SECRET`   | OAuth Instagram (Meta)            |
| `TIKTOK_CLIENT_KEY/SECRET`  | OAuth TikTok                      |
| `GOOGLE_ADS_*`              | Credentials Google Ads            |

---

## 12. Conventions de code

- **Backend Node** : ES Modules (`import/export`), pas de TypeScript
- **Frontend** : Next.js App Router, CSS pur (pas de framework CSS)
- **Python** : PEP 8, type hints recommandés
- **Base de données** : MongoDB driver natif (pas d'ODM type Mongoose)
- **Événements** : tout passe par Redis pub/sub → SocketCluster
- **Queues** : Redis lists (`lpush`/`rpop`) pour les jobs Celery

---

_Document généré pour l'onboarding — à maintenir à jour au fur et à mesure de l'avancement du projet._
