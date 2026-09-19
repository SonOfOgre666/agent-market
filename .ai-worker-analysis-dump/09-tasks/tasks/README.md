# Celery tasks — ONBOARDING §3 mapping

The onboarding tree lists flat `tasks/social.py` and `tasks/ads.py` for **discoverability by domain**.  
The running codebase uses packages (scalable) plus legacy modules (stable Celery names for Beat/API).

Use this map when reading the docs or adding tasks — **do not duplicate** flat files (Python cannot import both `tasks/social.py` and `tasks/social/`).

## Social (`tasks/social.py` in ONBOARDING)

| ONBOARDING intent | Celery name | Implementation |
|-------------------|-------------|----------------|
| Draft AI post | `tasks.social.create_draft_post` | `tasks/social/create_draft_post.py` |
| Publish scheduled | `tasks.scheduler.tick_due_posts` | `tasks/scheduler_beat.py` → `tasks.social.publish_post` |
| Publish post | `tasks.social.publish_post` | `tasks/social/publish_post.py` |
| Schedule post | `tasks.social.schedule_post` | `tasks/social/schedule_post.py` |

## Ads (`tasks/ads.py` in ONBOARDING)

| ONBOARDING intent | Celery name | Implementation |
|-------------------|-------------|----------------|
| Keyword research | `tasks.ads.execute_ads_tool` | `tasks/ads/execute_ads_tool.py` |
| Generate assets | `tasks.generate_campaign_assets` | `tasks/ads/campaign_content.py` → `lib/ads_marketing_content.py` |
| Landing page copy | `tasks.generate_landing_page_content` | `tasks/ads/campaign_content.py` |
| LP workflow | `tasks.ads.run_landing_page_workflow` | `tasks/ads/campaign_content.py` → API service |
| Optimize campaign | `tasks.optimize_campaign` | `tasks/ads/campaign_content.py` → `adsOptimization.runCampaignOptimization` |
| Budget pacing / bid / QS / A/B | `tasks.ads.run_*` | `tasks/ads/workspace_ops.py` → API internal routes |
| Publish campaign | `tasks.ads.publish_campaign` | `tasks/ads/publish_campaign.py` |
| Platform sync | `tasks.ads.sync_workspace_on_demand` | `tasks/ads/on_demand_sync.py` |

## Prompts

Task modules should **not** embed long LLM strings. Use `prompts/` + `lib/prompt_loader.py` (see `prompts/README.md`).

## Adding a task

1. Pick domain package (`tasks/social/`, `tasks/ads/`, …) or extend `_legacy_*` only if Beat/API already references a `tasks.*` name.
2. Register via `@celery_app.task(name='tasks....')` on the shared app.
3. Import the module from the package `__init__.py` or `tasks/__init__.py`.
