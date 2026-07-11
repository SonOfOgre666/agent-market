# Architecture Agent-Market

Ce document décrit le **style architectural réel** du projet. Il complète les diagrammes PlantUML dans [`architecture.puml`](architecture.puml).

## Verdict : ce n’est pas du MVC classique

| MVC classique | Agent-Market |
|---------------|--------------|
| Une application serveur rend des vues (HTML) | **Next.js** rend l’UI côté client (React / App Router) |
| Le contrôleur contient la logique métier | Les **routes Fastify** sont fines : auth, validation, délégation |
| Le modèle = entités + règles métier | Les **models/** sont surtout un **accès MongoDB** (fonctions par collection) |
| Tout se passe dans un processus | La **logique lourde** (publish, sync ads, imports) est dans **Celery** |

Le projet correspond plutôt à :

1. **Architecture en couches (Layered)** — présentation / API / application / données / infra  
2. **Monolithe modulaire** — dépôt unique, modules métier (Social, Ads, Agent)  
3. **Architecture orientée tâches (Task / Queue)** — Redis + Celery + bridge API  
4. **API as Source of Truth** — MongoDB mis à jour en priorité par `apps/api` ; le worker rappelle l’API via `/api/internal/worker/*`  
5. **Ports & adaptateurs (hexagonal, partiel)** — `connectors/` isolent Meta, Google Ads, X, etc.  
6. **Événements pour le temps réel** — `lib/events.js` → Redis pub/sub → SocketCluster  

Évolution visée (voir `Rules/CLEAN_ARCHITECTURE_ROADMAP.md`) : renforcer la séparation domaine / infrastructure et réduire les écritures Mongo directes dans le worker (`db.py`).

## Couches par composant

### `apps/web` — Présentation

- **Pages** : `app/**/page.js` (App Router)
- **Composants** : `components/`, `modules/agent/`
- **Client API** : `lib/api.js` (fetch vers `/api/*`, proxy ngrok)
- **État session** : `AuthProvider`, workspace dans le JWT

Pas de couche « modèle » côté web : le domaine vit côté API.

### `apps/api` — Backend HTTP

| Dossier | Rôle architectural |
|---------|-------------------|
| `routes/` | **Adaptateurs entrants** HTTP : validation requête, codes HTTP, appel services/models |
| `middleware/` | Authentification JWT, contexte `workspace_id` |
| `services/` | **Orchestration** légère (création post, enqueue worker, règles transverses) |
| `models/` | **Persistance** MongoDB (CRUD par collection) |
| `lib/` | Infrastructure : mongo, redis, events, celery enqueue |
| `providers/` | Intégrations côté API (OAuth helpers, refresh tokens) |
| `queue/dispatcher.js` | **Façade enqueue** vers Celery (une seule voie async) |
| `routes/worker_internal.js` | **API interne M2M** pour le worker (secret partagé) |

Flux typique **lecture** : `Route → Model → MongoDB → JSON`  
Flux typique **action lourde** : `Route → Service/Dispatcher → Redis bridge → Celery → worker_api → Internal route → Model → MongoDB`

### `services/ai-worker` — Exécution asynchrone

| Dossier | Rôle |
|---------|------|
| `tasks/` | **Cas d’usage exécutables** (publish_post, sync ads, imports, agent plan/execute) |
| `connectors/` | **Adaptateurs sortants** vers APIs externes (stateless) |
| `lib/worker_api.py` | Client HTTP vers l’API interne (persistance autoritaire) |
| `lib/llm/` | Appels modèles de langage (hors connecteurs marketing) |
| `agents/` | Planification / exécution workflows agent |
| `registry/tools.json` | Catalogue d’outils (UI + agent partagent les mêmes tâches) |

Principe (`Rules/PROJECT_PATTERN.md`) : **implémenter une capacité une fois** dans `tasks/` + `connectors/`, l’exposer via l’API (UI) et via l’agent (planner), sans dupliquer la logique d’exécution.

### Infrastructure partagée

- **MongoDB** : données applicatives (users, workspaces, posts, campaigns, agent, …)
- **Redis** : broker Celery, liste bridge `CELERY_REDIS_LIST`, pub/sub événements
- **SocketCluster** (`services/realtime`) : WebSocket vers le navigateur

## Modules produit (bounded contexts légers)

```text
┌─────────────────────────────────────────────────────────┐
│                    Workspace / Auth                      │
│         (User, Workspace, Account, Settings)             │
├──────────────┬────────────────────┬─────────────────────┤
│    Social    │        Ads         │       Agent         │
│ Post, Media  │ Campaign, Lead     │ Conversation,       │
│ Tag, Metric  │ LandingPage        │ Workflow, LLM tools │
└──────────────┴────────────────────┴─────────────────────┘
```

## Diagrammes PlantUML

| Diagramme dans `architecture.puml` | Contenu |
|-----------------------------------|---------|
| `agent-market-architecture-context` | Contexte C4 : acteurs, systèmes, dépendances |
| `agent-market-architecture-layers` | Couches logiques détaillées + légende patterns |
| `agent-market-architecture-flows` | Flux sync (lecture) vs async (enqueue → worker → internal API) |
| `agent-market-architecture-mvc-comparison` | MVC classique vs architecture réelle |
| `agent-market-architecture-deployment` | Vue Docker Compose |

Voir aussi [`components.puml`](components.puml) (vue composants runtime simplifiée).

## Références code

- [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)
- [`Rules/PROJECT_PATTERN.md`](../Rules/PROJECT_PATTERN.md)
- [`apps/api/src/server.js`](../apps/api/src/server.js) — enregistrement des routes
- [`services/ai-worker/lib/worker_api.py`](../services/ai-worker/lib/worker_api.py) — contrat worker → API
