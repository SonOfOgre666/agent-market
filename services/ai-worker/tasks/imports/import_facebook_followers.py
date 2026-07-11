"""Facebook follower counts — Graph via ``connectors.facebook``; persistence via apps/api."""

import logging
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId

from celery_app import celery_app
from connectors import facebook as facebook_connector
from db import get_redis
from lib import worker_api

logger = logging.getLogger(__name__)

RATE_KEY_PREFIX = 'agentmarket:ratelimit:facebook:'


@celery_app.task(name='tasks.imports.import_facebook_followers', bind=True, max_retries=3)
def import_facebook_followers(self, account_id: str):
    r = get_redis()
    try:
        ObjectId(account_id)
    except InvalidId:
        logger.warning('Invalid account_id: %s', account_id)
        return

    if not worker_api.configured():
        logger.warning('[import_facebook_followers] WORKER_API_SECRET not set — skipped')
        return

    try:
        account = worker_api.get_account_worker_context(account_id)
    except Exception:
        return

    if not account or not account.get('authorized') or account.get('provider') != 'facebook':
        return

    rate_key = f'{RATE_KEY_PREFIX}{account_id}'
    if r.get(rate_key):
        return

    token = (account.get('access_token') or {}).get('token')
    if not token:
        return

    pid = account.get('provider_id')
    if not pid:
        return

    result = facebook_connector.fetch_page_follower_counts(token, str(pid))
    if result.get('ok'):
        data = result.get('data') or {}
        total = data.get('followers_count')
        if total is None:
            total = data.get('fan_count') or 0
        today = datetime.now(timezone.utc).date().isoformat()
        worker_api.upsert_audience(account_id, today, int(total))
        logger.info('[import_facebook_followers] account=%s followers=%s', account_id, total)
        return

    if result.get('rate_limited'):
        r.setex(rate_key, 3600, '1')
        logger.warning('[import_facebook_followers] 429 %s', account_id)
        return
    if result.get('unauthorized'):
        try:
            worker_api.patch_account_deauthorized(account_id)
        except Exception as exc:
            logger.error('[import_facebook_followers] deauthorize failed: %s', exc)
        logger.warning('[import_facebook_followers] unauthorized %s', account_id)
        return

    sc = int(result.get('status_code') or 0)
    logger.error('[import_facebook_followers] account=%s status=%s', account_id, sc)
    raise self.retry(exc=RuntimeError(result.get('error', 'Graph error')), countdown=300) from None
