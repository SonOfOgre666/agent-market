"""Facebook page insights — Graph via ``connectors.facebook``; persistence via apps/api."""

import logging
from datetime import datetime, timezone, timedelta

from bson import ObjectId
from bson.errors import InvalidId

from celery_app import celery_app
from connectors import facebook as facebook_connector
from db import get_redis
from lib import worker_api

logger = logging.getLogger(__name__)

RATE_KEY_PREFIX = 'agentmarket:ratelimit:facebook:'

METRIC_NAME_TO_TYPE = {
    'page_post_engagements': 1,
    'page_posts_impressions': 2,
}


@celery_app.task(name='tasks.imports.import_facebook_insights', bind=True, max_retries=3)
def import_facebook_insights(self, account_id: str):
    r = get_redis()
    try:
        ObjectId(account_id)
    except InvalidId:
        logger.warning('Invalid account_id: %s', account_id)
        return

    if not worker_api.configured():
        logger.warning('[import_facebook_insights] WORKER_API_SECRET not set — skipped')
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

    since = (datetime.now(timezone.utc) - timedelta(days=90)).date().isoformat()
    until = datetime.now(timezone.utc).date().isoformat()

    result = facebook_connector.fetch_page_insights_day_series(
        token,
        str(pid),
        since=since,
        until=until,
    )

    if result.get('ok'):
        insights = result.get('insights') or []
        for insight in insights:
            name = insight.get('name')
            itype = METRIC_NAME_TO_TYPE.get(name)
            if not itype:
                continue
            for item in insight.get('values') or []:
                end_time = item.get('end_time') or ''
                date = end_time.split('T')[0] if end_time else until
                val = item.get('value')
                if val is None:
                    val = 0
                worker_api.upsert_facebook_insight(account_id, itype, val, date)

        logger.info('[import_facebook_insights] account=%s insight_types=%s', account_id, len(insights))
        return

    if result.get('rate_limited'):
        r.setex(rate_key, 3600, '1')
        logger.warning('[import_facebook_insights] 429 %s', account_id)
        return
    if result.get('unauthorized'):
        try:
            worker_api.patch_account_deauthorized(account_id)
        except Exception as exc:
            logger.error('[import_facebook_insights] deauthorize failed: %s', exc)
        logger.warning('[import_facebook_insights] unauthorized %s', account_id)
        return

    sc = int(result.get('status_code') or 0)
    logger.error('[import_facebook_insights] account=%s status=%s', account_id, sc)
    raise self.retry(exc=RuntimeError(result.get('error', 'Graph error')), countdown=300) from None
