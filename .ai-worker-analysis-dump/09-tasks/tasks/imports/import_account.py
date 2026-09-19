"""Import orchestration: fans out to provider-specific Celery tasks."""

import logging

from bson import ObjectId
from bson.errors import InvalidId

from celery_app import celery_app
from lib import worker_api

logger = logging.getLogger(__name__)


@celery_app.task(name='tasks.imports.import_account')
def import_account(account_id: str):
    try:
        ObjectId(account_id)
    except InvalidId:
        logger.warning('[import_account] invalid account_id=%s', account_id)
        return

    if not worker_api.configured():
        logger.warning('[import_account] WORKER_API_SECRET not set — skipped')
        return

    try:
        account = worker_api.get_account_worker_context(account_id)
    except Exception as exc:
        logger.warning('[import_account] no account %s: %s', account_id, exc)
        return

    if not account or not account.get('authorized'):
        return

    p = account.get('provider') or ''
    if p == 'twitter':
        celery_app.send_task('tasks.imports.import_twitter_followers', args=[account_id])
        celery_app.send_task('tasks.imports.import_twitter_posts', args=[account_id])
        celery_app.send_task('tasks.analytics.process_twitter_metrics', args=[account_id])
        logger.info('[import_account] queued twitter import chain for %s', account_id)
    elif p == 'facebook':
        celery_app.send_task('tasks.imports.import_facebook_followers', args=[account_id])
        celery_app.send_task('tasks.imports.import_facebook_insights', args=[account_id])
        logger.info('[import_account] queued facebook import chain for %s', account_id)
    elif p in ('instagram', 'instagram_login'):
        celery_app.send_task('tasks.imports.import_instagram_followers', args=[account_id])
        celery_app.send_task('tasks.imports.import_instagram_insights', args=[account_id])
        celery_app.send_task('tasks.imports.import_instagram_media', args=[account_id])
        logger.info('[import_account] queued instagram import chain for %s provider=%s', account_id, p)
    else:
        logger.debug('[import_account] no orchestration for provider=%s account=%s', p, account_id)
