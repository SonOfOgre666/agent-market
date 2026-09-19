"""
Daily Google Ads + Meta campaign upsert — connectors fetch, API persists (internal routes).
"""

from __future__ import annotations

import logging

from celery_app import celery_app
from lib import worker_api
from tasks.ads.sync_workspace_execute import execute_workspace_ads_sync

logger = logging.getLogger(__name__)


@celery_app.task(name='tasks.scheduler.ads_platform_sync_daily')
def ads_platform_sync_daily():
    if not worker_api.configured():
        logger.warning('[ads_sync] WORKER_API_SECRET not set — skipped')
        return
    try:
        plan = worker_api.get_ads_sync_job_plan()
    except Exception as exc:
        logger.exception('[ads_sync] job plan failed: %s', exc)
        return

    total_g = total_m = 0
    for ws in plan.get('workspaces') or []:
        wid = ws.get('workspace_id')
        if not wid:
            continue
        try:
            stats = execute_workspace_ads_sync(str(wid))
            total_g += int(stats.get('google') or 0)
            total_m += int(stats.get('meta') or 0)
        except Exception as exc:
            logger.error('[ads_sync] workspace=%s err=%s', wid, exc)

    logger.info(
        '[ads_sync] daily complete google_rows=%s meta_rows=%s workspaces=%s',
        total_g,
        total_m,
        len(plan.get('workspaces') or []),
    )
