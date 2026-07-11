"""Twitter/X follower import — API via ``connectors.twitter``; persistence via apps/api."""

import logging
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId

from celery_app import celery_app
from connectors import twitter as twitter_connector
from db import get_redis
from lib import worker_api

logger = logging.getLogger(__name__)

RATE_KEY_PREFIX = 'agentmarket:ratelimit:twitter:'


@celery_app.task(name='tasks.imports.import_twitter_followers', bind=True, max_retries=3)
def import_twitter_followers(self, account_id: str):
    r = get_redis()
    try:
        ObjectId(account_id)
    except InvalidId:
        logger.warning('Invalid account_id: %s', account_id)
        return

    if not worker_api.configured():
        logger.warning('[import_twitter_followers] WORKER_API_SECRET not set — skipped')
        return

    try:
        account = worker_api.get_account_worker_context(account_id)
    except Exception as exc:
        logger.warning('[import_twitter_followers] no account %s: %s', account_id, exc)
        return

    if not account or not account.get('authorized'):
        return

    rate_key = f'{RATE_KEY_PREFIX}{account_id}'
    if r.get(rate_key):
        logger.info('[import_twitter_followers] rate limited, skip %s', account_id)
        return

    if account.get('provider') != 'twitter':
        return

    at = account.get('access_token') or {}
    token, secret = at.get('token'), at.get('secret')
    if not token:
        return

    wid = account.get('workspace_id')
    wid_str = str(wid) if wid is not None else None
    try:
        cfg = worker_api.get_service_decrypted('twitter', wid_str)
    except Exception:
        cfg = {}
    if not cfg.get('client_id') or not cfg.get('client_secret'):
        logger.error('[import_twitter_followers] missing twitter service client_id/secret from API')
        return

    read = twitter_connector.fetch_authenticated_user_followers(
        str(cfg.get('client_id')),
        str(cfg.get('client_secret')),
        str(token),
        str(secret or ''),
    )

    if read.ok:
        today = datetime.now(timezone.utc).date().isoformat()
        worker_api.upsert_audience(account_id, today, int(read.followers_count))
        logger.info('[import_twitter_followers] account=%s followers=%s', account_id, read.followers_count)
        return

    if read.rate_limited:
        r.setex(rate_key, 900, '1')
        logger.warning('[import_twitter_followers] 429 for %s', account_id)
        return
    if read.unauthorized:
        try:
            worker_api.patch_account_deauthorized(account_id)
        except Exception as exc:
            logger.error('[import_twitter_followers] deauthorize failed %s: %s', account_id, exc)
        logger.warning('[import_twitter_followers] unauthorized %s', account_id)
        return

    logger.error('[import_twitter_followers] account=%s retryable', account_id)
    raise self.retry(exc=RuntimeError('Twitter API error'), countdown=120) from None
