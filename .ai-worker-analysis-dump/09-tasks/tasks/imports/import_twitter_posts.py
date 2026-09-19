"""Twitter/X timeline import — API via ``connectors.twitter``; persistence via apps/api."""

import logging
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from dateutil.relativedelta import relativedelta

from celery_app import celery_app
from connectors import twitter as twitter_connector
from db import get_redis
from lib import worker_api

logger = logging.getLogger(__name__)
RATE_KEY_PREFIX = 'agentmarket:ratelimit:twitter:'


@celery_app.task(name='tasks.imports.import_twitter_posts', bind=True, max_retries=3)
def import_twitter_posts(self, account_id: str, pagination_token: str = ''):
    r = get_redis()
    try:
        ObjectId(account_id)
    except InvalidId:
        logger.warning('Invalid account_id: %s', account_id)
        return

    if not worker_api.configured():
        logger.warning('[import_twitter_posts] WORKER_API_SECRET not set — skipped')
        return

    try:
        account = worker_api.get_account_worker_context(account_id)
    except Exception:
        logger.warning('[import_twitter_posts] no account %s', account_id)
        return

    if not account or not account.get('authorized'):
        return

    rate_key = f'{RATE_KEY_PREFIX}{account_id}'
    if r.get(rate_key):
        return

    if account.get('provider') != 'twitter':
        return

    wid = account.get('workspace_id')
    wid_str = str(wid) if wid is not None else None
    try:
        cfg = worker_api.get_service_decrypted('twitter', wid_str)
    except Exception:
        cfg = {}
    tier = (cfg.get('tier') or 'free')
    if tier == 'free':
        return

    at = account.get('access_token') or {}
    token, secret = at.get('token'), at.get('secret')
    if not token:
        return

    client_id = cfg.get('client_id')
    client_secret = cfg.get('client_secret')
    if not client_id or not client_secret:
        logger.error('[import_twitter_posts] missing twitter service client_id/secret')
        return

    provider_id = account.get('provider_id')
    if not provider_id:
        return

    since = datetime.now(timezone.utc) - relativedelta(months=3)

    page = twitter_connector.fetch_user_timeline_page(
        str(client_id),
        str(client_secret),
        str(token),
        str(secret or ''),
        str(provider_id),
        since,
        pagination_token=pagination_token or '',
    )

    if page.ok:
        for row in page.tweets:
            tid = row['id']
            worker_api.upsert_imported_post(
                account_id,
                tid,
                {'text': row['text'], 'created_at': row['created_at']},
                {
                    'likes': row['likes'],
                    'replies': row['replies'],
                    'retweets': row['retweets'],
                    'impressions': row['impressions'],
                },
            )

        if page.next_token:
            celery_app.send_task(
                'tasks.imports.import_twitter_posts',
                args=[account_id, page.next_token],
            )
            logger.info('[import_twitter_posts] queued next page account=%s', account_id)

        logger.info('[import_twitter_posts] account=%s tweets=%s', account_id, len(page.tweets))
        return

    if page.rate_limited:
        r.setex(rate_key, 900, '1')
        logger.warning('[import_twitter_posts] 429 for %s', account_id)
        return
    if page.unauthorized:
        try:
            worker_api.patch_account_deauthorized(account_id)
        except Exception as exc:
            logger.error('[import_twitter_posts] deauthorize failed %s: %s', account_id, exc)
        logger.warning('[import_twitter_posts] unauthorized %s', account_id)
        return

    logger.error('[import_twitter_posts] account=%s err=retryable', account_id)
    raise self.retry(exc=RuntimeError('Twitter API error'), countdown=120) from None
