"""Run LLM analysis for a synced comment (auto-analyze or manual re-queue)."""

from __future__ import annotations

import logging

from celery_app import celery_app
from lib import worker_api

logger = logging.getLogger(__name__)


@celery_app.task(name='tasks.social.analyze_post_comment')
def analyze_post_comment(comment_uuid: str):
    if not worker_api.configured():
        logger.warning('[analyze_post_comment] WORKER_API_SECRET not set — skipped uuid=%s', comment_uuid)
        return
    try:
        worker_api.analyze_post_comment(comment_uuid)
    except Exception as exc:
        logger.exception('[analyze_post_comment] failed uuid=%s: %s', comment_uuid, exc)
