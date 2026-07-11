"""Workspace-level ads optimization — thin Celery wrappers over API internal routes."""

from __future__ import annotations

import logging

from celery_app import celery_app
from lib import worker_api

logger = logging.getLogger(__name__)


def _require_worker_api() -> None:
    if not worker_api.configured():
        raise RuntimeError('WORKER_API_SECRET not set')


@celery_app.task(name='tasks.ads.run_budget_pacing', soft_time_limit=300, time_limit=360)
def run_budget_pacing(body: dict | None = None):
    _require_worker_api()
    return worker_api.run_workspace_budget_pacing(body or {})


@celery_app.task(name='tasks.ads.run_budget_reallocation', soft_time_limit=120, time_limit=180)
def run_budget_reallocation(body: dict | None = None):
    _require_worker_api()
    return worker_api.run_workspace_budget_reallocation(body or {})


@celery_app.task(name='tasks.ads.run_bid_optimization', soft_time_limit=300, time_limit=360)
def run_bid_optimization(body: dict | None = None):
    _require_worker_api()
    return worker_api.run_workspace_bid_optimization(body or {})


@celery_app.task(name='tasks.ads.run_quality_score_monitor', soft_time_limit=180, time_limit=240)
def run_quality_score_monitor(body: dict | None = None):
    _require_worker_api()
    return worker_api.run_workspace_quality_score_monitor(body or {})


@celery_app.task(name='tasks.ads.run_asset_ab_analysis', soft_time_limit=180, time_limit=240)
def run_asset_ab_analysis(body: dict | None = None):
    _require_worker_api()
    return worker_api.run_workspace_asset_ab_analysis(body or {})


def run_optimize_campaign_tool(body: dict) -> dict:
    campaign_id = str(body.get('campaign_id') or '').strip()
    if not campaign_id:
        raise ValueError('campaign_id is required')
    from tasks.ads.campaign_content import run_optimize_campaign

    return run_optimize_campaign(campaign_id, body)
