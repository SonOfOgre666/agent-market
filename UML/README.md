# Diagrammes UML — Agent-Market

Documentation UML du projet **agent-market** (marketing social, publicité payante, assistant IA). Les fichiers sont au format [PlantUML](https://plantuml.com/) (`.puml`).

## Fichiers

| Fichier | Type UML | Contenu |
|---------|----------|---------|
| [`classes.puml`](classes.puml) | Diagramme de classes | Modèles MongoDB, relations workspace, entités sociales / ads / agent |
| [`use-cases.puml`](use-cases.puml) | Cas d'utilisation | Acteurs (Utilisateur, Visiteur, Worker Celery) et fonctionnalités |
| [`sequence-auth.puml`](sequence-auth.puml) | Séquence | Inscription, connexion JWT, contexte workspace |
| [`sequence-publish-post.puml`](sequence-publish-post.puml) | Séquence | Planification et publication d'un post social |
| [`sequence-agent-workflow.puml`](sequence-agent-workflow.puml) | Séquence | Chat agent, planification et exécution de workflow |
| [`sequence-ads-sync.puml`](sequence-ads-sync.puml) | Séquence | Synchronisation campagnes Google / Meta |
| [`sequence-oauth-account.puml`](sequence-oauth-account.puml) | Séquence | Connexion d'un compte social ou ads (OAuth) |
| [`architecture.puml`](architecture.puml) | **Architecture** | Contexte C4, couches logiques, flux sync/async, comparaison MVC, déploiement Docker |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Documentation | Style architectural (layered + tasks + API source of truth), tableau des couches |
| [`components.puml`](components.puml) | Composants | Vue runtime simplifiée : web, API, worker, MongoDB, Redis, plateformes |

## Visualisation

### VS Code / Cursor

Extension recommandée : **PlantUML** (jebbs.plantuml). Ouvrir un `.puml` puis « Preview Current Diagram ».

### Ligne de commande

```bash
# Debian/Fedora : plantuml ou java -jar plantuml.jar
plantuml -tsvg UML/*.puml
# Sortie : UML/*.svg dans le même dossier
```

### En ligne

Coller le contenu d'un fichier sur [plantuml.com/plantuml](https://www.plantuml.com/plantuml/uml/) ou utiliser un renderer GitHub si les `.svg` sont commités.

## Alignement avec le code

| Concept UML | Code source |
|-------------|-------------|
| Modèles domaine | `apps/api/src/models/*.js` |
| Routes API | `apps/api/src/routes/*.js` |
| Worker interne (M2M) | `apps/api/src/routes/worker_internal.js` |
| Tâches Celery | `services/ai-worker/tasks/` |
| Connecteurs plateformes | `services/ai-worker/connectors/` |
| UI | `apps/web/` (Next.js App Router) |
| Temps réel | `services/realtime/` (SocketCluster) |

Voir aussi [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).
