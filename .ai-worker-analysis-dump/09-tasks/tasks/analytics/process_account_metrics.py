"""Parity with apps/api/src/jobs/ProcessMetrics.js — generic provider metrics (no-op unless provider hooks exist)."""

import logging

from bson import ObjectId
from bson.errors import InvalidId

from celery_app import celery_app
from lib import worker_api

logger = logging.getLogger(__name__)


@celery_app.task(name='tasks.analytics.process_account_metrics')
def process_account_metrics(account_id: str):
    try:
        ObjectId(account_id)
    except InvalidId:
        logger.warning('[process_account_metrics] invalid account_id=%s', account_id)
        return

    if not worker_api.configured():
        logger.warning('[process_account_metrics] WORKER_API_SECRET not set — skipped')
        return

    try:
        account = worker_api.get_account_worker_context(account_id)
    except Exception:
        return

    if not account or not account.get('authorized'):
        return

    provider = account.get('provider') or ''
    logger.debug(
        '[process_account_metrics] account=%s provider=%s (no provider metric hooks in codebase — noop)',
        account_id,
        provider,
    )
