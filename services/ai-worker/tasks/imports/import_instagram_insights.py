"""Instagram account insights (reach, views) — requires manage_insights scope."""

import logging
from datetime import datetime, timezone, timedelta

from bson import ObjectId
from bson.errors import InvalidId

from celery_app import celery_app
from connectors import _ig_analytics as ig_analytics
from db import get_redis
from lib import worker_api

logger = logging.getLogger(__name__)

RATE_KEY_PREFIX = 'agentmarket:ratelimit:instagram:insights:'
IG_PROVIDERS = frozenset({'instagram', 'instagram_login'})


def _fb_cfg_for(account: dict) -> dict:
    wid = account.get('workspace_id')
    wid_str = str(wid) if wid is not None else None
    try:
        return dict(worker_api.get_service_decrypted('facebook', wid_str) or {})
    except Exception:
        return {}


def _merge_metric_rows(account_id: str, rows: list) -> None:
    if not rows:
        return
    items = []
    for row in rows:
        day = row.get('date')
        if not day:
            continue
        data = {k: v for k, v in row.items() if k != 'date'}
        if not data:
            continue
        items.append({'account_id': account_id, 'date': day, 'data': data, 'merge': True})
    if items:
        worker_api.bulk_upsert_metrics(items)


@celery_app.task(name='tasks.imports.import_instagram_insights', bind=True, max_retries=3)
def import_instagram_insights(self, account_id: str):
    r = get_redis()
    try:
        ObjectId(account_id)
    except InvalidId:
        logger.warning('Invalid account_id: %s', account_id)
        return

    if not worker_api.configured():
        logger.warning('[import_instagram_insights] WORKER_API_SECRET not set — skipped')
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
    pid = account.get('provider_id')
    if not token or not pid:
        return

    since = (datetime.now(timezone.utc) - timedelta(days=90)).date().isoformat()
    until = datetime.now(timezone.utc).date().isoformat()
    fb_cfg = _fb_cfg_for(account) if provider == 'instagram' else None

    result = ig_analytics.fetch_account_insights_day_series(
        token,
        str(pid),
        provider=provider,
        since=since,
        until=until,
        fb_cfg=fb_cfg,
    )

    if result.get('ok'):
        rows = result.get('rows') or []
        _merge_metric_rows(account_id, rows)
        logger.info('[import_instagram_insights] account=%s days=%s', account_id, len(rows))
        return

    if result.get('rate_limited'):
        r.setex(rate_key, 3600, '1')
        logger.warning('[import_instagram_insights] 429 %s', account_id)
        return
    if result.get('unauthorized'):
        try:
            worker_api.patch_account_deauthorized(account_id)
        except Exception as exc:
            logger.error('[import_instagram_insights] deauthorize failed: %s', exc)
        logger.warning('[import_instagram_insights] unauthorized %s', account_id)
        return
    if result.get('forbidden'):
        logger.warning(
            '[import_instagram_insights] missing insights scope account=%s — reconnect with instagram_business_manage_insights',
            account_id,
        )
        return

    logger.error('[import_instagram_insights] account=%s retryable', account_id)
    raise self.retry(exc=RuntimeError(result.get('error', 'Graph error')), countdown=300) from None
