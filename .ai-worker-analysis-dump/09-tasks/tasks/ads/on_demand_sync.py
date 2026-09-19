"""User-triggered workspace ads sync — connectors + API persist (same path as Beat)."""

from __future__ import annotations

import logging

from celery_app import celery_app
from lib import worker_api
from tasks.ads.sync_workspace_execute import execute_workspace_ads_sync

logger = logging.getLogger(__name__)


@celery_app.task(name='tasks.ads.sync_workspace_on_demand')
def sync_workspace_on_demand(workspace_id: str):
    if not worker_api.configured():
        logger.warning('[ads_sync_on_demand] WORKER_API_SECRET not set — skipped workspace=%s', workspace_id)
        return
    try:
        stats = execute_workspace_ads_sync(str(workspace_id))
        logger.info('[ads_sync_on_demand] workspace=%s stats=%s', workspace_id, stats)
    except Exception as exc:
        logger.exception('[ads_sync_on_demand] workspace=%s err=%s', workspace_id, exc)
        raise
