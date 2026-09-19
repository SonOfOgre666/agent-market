"""Instagram follower snapshots — Graph via ``connectors._ig_analytics``."""

import logging
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId

from celery_app import celery_app
from connectors import _ig_analytics as ig_analytics
from db import get_redis
from lib import worker_api

logger = logging.getLogger(__name__)

RATE_KEY_PREFIX = 'agentmarket:ratelimit:instagram:'
IG_PROVIDERS = frozenset({'instagram', 'instagram_login'})


def _fb_cfg_for(account: dict) -> dict:
    wid = account.get('workspace_id')
    wid_str = str(wid) if wid is not None else None
    try:
        return dict(worker_api.get_service_decrypted('facebook', wid_str) or {})
    except Exception:
        return {}


@celery_app.task(name='tasks.imports.import_instagram_followers', bind=True, max_retries=3)
def import_instagram_followers(self, account_id: str):
    r = get_redis()
    try:
        ObjectId(account_id)
    except InvalidId:
        logger.warning('Invalid account_id: %s', account_id)
        return

    if not worker_api.configured():
        logger.warning('[import_instagram_followers] WORKER_API_SECRET not set — skipped')
        return

    try:
        account = worker_api.get_account_worker_context(account_id)
    except Exception:
        return

    provider = str(account.get('provider') or '')
    if not account or not account.get('authorized') or provider not in IG_PROVIDERS:
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

    fb_cfg = _fb_cfg_for(account) if provider == 'instagram' else None
    result = ig_analytics.fetch_user_followers_count(
        token,
        str(pid),
        provider=provider,
        fb_cfg=fb_cfg,
    )

    if result.get('ok'):
        total = int(result.get('followers_count') or 0)
        today = datetime.now(timezone.utc).date().isoformat()
        worker_api.upsert_audience(account_id, today, total)
        logger.info('[import_instagram_followers] account=%s provider=%s followers=%s', account_id, provider, total)
        return

    if result.get('rate_limited'):
        r.setex(rate_key, 3600, '1')
        logger.warning('[import_instagram_followers] 429 %s', account_id)
        return
    if result.get('unauthorized'):
        try:
            worker_api.patch_account_deauthorized(account_id)
        except Exception as exc:
            logger.error('[import_instagram_followers] deauthorize failed: %s', exc)
        logger.warning('[import_instagram_followers] unauthorized %s', account_id)
        return

    if result.get('forbidden'):
        logger.warning(
            '[import_instagram_followers] forbidden account=%s provider=%s (reconnect may be required)',
            account_id,
            provider,
        )
        return

    logger.error('[import_instagram_followers] account=%s retryable', account_id)
    raise self.retry(exc=RuntimeError(result.get('error', 'Graph error')), countdown=300) from None
