# Agent-Market

Scaffold monorepo pour un agent AI marketing multi-canal avec ta stack:

- MongoDB
- Fastify
- SocketCluster
- Next.js
- Redis
- Python + Celery
- Connecteurs AI (OpenAI, Anthropic, etc.)

## Structure

- `apps/web`: interface Next.js (HTML/CSS pur)
- `apps/api`: API Fastify
- `services/realtime`: serveur SocketCluster
- `services/ai-worker`: worker Python Celery
- `docs/ARCHITECTURE.md`: vue architecture

## Prerequis

- Node.js 20+
- Python 3.11+
- Docker + Docker Compose

## Quick Start

1. Copier les variables:

```bash
cp .env.example .env
```

2. Lancer MongoDB et Redis:

```bash
docker compose up -d
```

3. Installer les dependances Node:

```bash
npm install
```

4. Lancer les services Node:

```bash
npm run dev
```

5. Installer les dependances Python worker:

```bash
cd services/ai-worker
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

6. Lancer Celery:

```bash
cd services/ai-worker
source .venv/bin/activate
celery -A celery_app.celery_app worker -l info
```

7. Lancer Celery Beat (scheduler):

```bash
cd services/ai-worker
source .venv/bin/activate
celery -A celery_app.celery_app beat -l info
```

## Endpoints de base

- API root: `http://localhost:4010/`
- Health: `http://localhost:4010/api/health`
- Draft social: `POST http://localhost:4010/api/social/posts/draft`
- Schedule social post: `POST http://localhost:4010/api/social/posts/schedule`
- List social posts: `GET http://localhost:4010/api/social/posts?userId=wetaxi`
- Publish now: `POST http://localhost:4010/api/social/posts/:postId/publish-now`
- Keywords ads: `POST http://localhost:4010/api/ads/keywords/suggest`
- Create ads campaign: `POST http://localhost:4010/api/ads/campaigns`
- List ads campaigns: `GET http://localhost:4010/api/ads/campaigns?userId=wetaxi`
- Generate ads assets: `POST /api/ads/campaigns/:campaignId/generate-assets`
- Generate landing page: `POST /api/ads/campaigns/:campaignId/generate-landing-page`
- Optimize campaign: `POST /api/ads/campaigns/:campaignId/optimize`
- List landing pages: `GET /api/ads/landing-pages?userId=wetaxi`
- Get landing page by slug: `GET /api/ads/landing-pages/:slug?userId=wetaxi`
- Capture lead: `POST /api/ads/landing-pages/:slug/lead`
- List leads: `GET /api/ads/leads?userId=wetaxi`
- OAuth providers: `GET http://localhost:4010/api/integrations/providers`
- OAuth connect URL: `GET http://localhost:4010/api/integrations/:provider/connect?userId=wetaxi`
- OAuth status: `GET http://localhost:4010/api/integrations/:provider/status?userId=wetaxi`
- Diagnostics credentials: `GET http://localhost:4010/api/integrations/diagnostics?userId=wetaxi`
- Google Ads refresh token: `GET http://localhost:4010/api/integrations/google-ads/refresh-token?userId=wetaxi`
- Dashboard overview: `GET http://localhost:4010/api/dashboard/overview?userId=wetaxi`
- Web dashboard: `http://localhost:3000`
- Realtime (WS): `ws://localhost:8000`

## OAuth social (LinkedIn, Instagram, TikTok)

1. Renseigner les credentials dans `.env`.
2. Enregistrer les redirect URIs dans chaque plateforme:

- `http://localhost:4010/api/integrations/linkedin/callback`
- `http://localhost:4010/api/integrations/instagram/callback`
- `http://localhost:4010/api/integrations/tiktok/callback`
- `http://localhost:4010/api/integrations/twitter/callback`
- `http://localhost:4010/api/integrations/facebook_page/callback`
- `http://localhost:4010/api/integrations/instagram_login/callback`

3. Ouvrir l URL de connexion:

```bash
curl "http://localhost:4010/api/integrations/linkedin/connect?userId=wetaxi"
```

4. Suivre `authUrl` dans le navigateur pour autoriser le compte.
5. Verifier la connexion:

```bash
curl "http://localhost:4010/api/integrations/linkedin/status?userId=wetaxi"
```

Note LinkedIn publication:

- Renseigner aussi `LINKEDIN_AUTHOR_URN` dans `.env`.
- Sans token/URN valides, la publication reste en mode `dry_run` (pas de post externe).

## Publication planifiee LinkedIn (MVP)

1. Creer un draft:

```bash
curl -X POST "http://localhost:4010/api/social/posts/draft" \
	-H "Content-Type: application/json" \
	-d '{"userId":"wetaxi","channel":"linkedin","text":"Post test LinkedIn"}'
```

2. Planifier avec `scheduledAt` (ISO datetime).
3. Le worker + beat traitent automatiquement les posts dus.
4. Publication immediate possible via `publish-now`.

## Pipeline Google Ads (MVP)

1. Creer une campagne:

```bash
curl -X POST "http://localhost:4010/api/ads/campaigns" \
	-H "Content-Type: application/json" \
	-d '{"userId":"wetaxi","name":"Spring Promo","goal":"leads","budgetDaily":180}'
```

2. Lancer generation assets RSA: `POST /api/ads/campaigns/:campaignId/generate-assets`
3. Lancer generation landing page: `POST /api/ads/campaigns/:campaignId/generate-landing-page`
4. Lancer optimization continue: `POST /api/ads/campaigns/:campaignId/optimize`
5. Worker + beat traitent automatiquement les queues Redis.
6. Ouvrir la page generee dans Next.js: `http://localhost:3000/lp/<slug>`
7. Tester avec UTM: `http://localhost:3000/lp/<slug>?utm_source=google&utm_medium=cpc&utm_campaign=test`

Note Google Ads:

- Tant que les credentials Google Ads sont incomplets, le connecteur tourne en mode fallback/stub.
- Les structures de pipeline et d'optimisation restent actives pour tests locaux.
- OAuth Google Ads local:
  - `GET http://localhost:4010/api/integrations/google-ads/connect?userId=wetaxi`
  - Callback attendu: `http://localhost:4010/api/integrations/google-ads/callback`
  - Verifier token: `GET http://localhost:4010/api/integrations/google-ads/status?userId=wetaxi`

## Realtime events (SocketCluster + Redis Pub/Sub)

- Canal Redis: `EVENTS_CHANNEL` (par defaut `agent_market:events`)
- Le serveur realtime relaie ce canal vers le channel SocketCluster `events`.
- Le dashboard Next.js affiche les stats + le feed live.

## Prochaines etapes recommandees

1. Ajouter OAuth officiel LinkedIn/Meta/TikTok.
2. Connecter Google Ads API (Keyword Planner + Campaign management).
3. Creer un scheduler de publication (Celery Beat).
4. Ajouter moderation policy avant reponses automatiques.
5. Ajouter tracking UTM + conversions + ROI/ROAS dashboard.
