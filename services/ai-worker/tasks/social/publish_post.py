"""
Publish post: Celery task calls providers; **all Mongo updates go through apps/api** (``lib.worker_api``).
"""

import logging

from bson import ObjectId
from bson.errors import InvalidId

from celery_app import celery_app
from lib import worker_api

from .publish_native import NodeFallback, run_native_publish_post

logger = logging.getLogger(__name__)

PostStatus_FAILED = 3
ScheduleStatus_PROCESSED = 2


def _mark_post_unsupported(post_id: str, message: str) -> None:
    if not worker_api.configured():
        logger.error('[publish_post] WORKER_API_SECRET not set — cannot mark failure for %s', post_id)
        return
    try:
        ObjectId(post_id)
    except InvalidId:
        logger.error('[publish_post] invalid post_id for failure mark: %s', post_id)
        return
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    try:
        worker_api.patch_post(
            post_id,
            {'status': PostStatus_FAILED, 'schedule_status': ScheduleStatus_PROCESSED, 'updated_at': now},
        )
    except Exception as exc:
        logger.error('[publish_post] patch_post failed: %s', exc)
        return
    try:
        worker_api.emit_event('post.failed', {'post_id': post_id, 'error': message})
    except Exception as exc:
        logger.warning('[publish_post] emit_event failed: %s', exc)


@celery_app.task(name='tasks.social.publish_post')
def publish_post(post_id: str):
    try:
        run_native_publish_post(post_id)
    except NodeFallback:
        logger.warning('[publish_post] NodeFallback post_id=%s — marking failed (no Node proxy)', post_id)
        _mark_post_unsupported(
            post_id,
            'Publishing is not implemented for one or more selected accounts (unsupported provider or mixed batch). '
            'Supported in worker: Twitter, LinkedIn (text/image/video), Facebook Page, Instagram, Instagram Login, TikTok.',
        )
