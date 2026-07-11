"""Instagram media list + per-media insights into ``imported_posts``."""

import logging
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId

from celery_app import celery_app
from connectors import _ig_analytics as ig_analytics
from db import get_redis
from lib import worker_api

logger = logging.getLogger(__name__)

RATE_KEY_PREFIX = 'agentmarket:ratelimit:instagram:media:'
IG_PROVIDERS = frozenset({'instagram', 'instagram_login'})
MAX_PAGES = 8


def _fb_cfg_for(account: dict) -> dict:
    wid = account.get('workspace_id')
    wid_str = str(wid) if wid is not None else None
    try:
        return dict(worker_api.get_service_decrypted('facebook', wid_str) or {})
    except Exception:
        return {}


def _media_metrics(media: dict, insights: dict) -> dict:
    merged = {
        'likes': int(media.get('like_count') or insights.get('likes') or 0),
        'comments': int(media.get('comments_count') or insights.get('comments') or 0),
        'reach': int(insights.get('reach') or 0),
        'views': int(insights.get('views') or 0),
    }
    return merged


@celery_app.task(name='tasks.imports.import_instagram_media', bind=True, max_retries=3)
def import_instagram_media(self, account_id: str, after: str = '', page: int = 0):
    r = get_redis()
    try:
        ObjectId(account_id)
    except InvalidId:
        logger.warning('Invalid account_id: %s', account_id)
        return

    if not worker_api.configured():
        logger.warning('[import_instagram_media] WORKER_API_SECRET not set — skipped')
        return

    try:
        account = worker_api.get_account_worker_context(account_id)
    except Exception:
        return

    provider = str(account.get('provider') or '')
    if not account or not account.get('authorized') or provider not in IG_PROVIDERS:
        return

    rate_key = f'{RATE_KEY_PREFIX}{account_id}'
    if r.get(rate_key) and not after:
        return

    token = (account.get('access_token') or {}).get('token')
    pid = account.get('provider_id')
    if not token or not pid:
        return

    fb_cfg = _fb_cfg_for(account) if provider == 'instagram' else None
    page_result = ig_analytics.fetch_user_media_page(
        token,
        str(pid),
        provider=provider,
        after=after,
        fb_cfg=fb_cfg,
    )

    if not page_result.get('ok'):
        if page_result.get('rate_limited'):
            r.setex(rate_key, 3600, '1')
            logger.warning('[import_instagram_media] 429 %s', account_id)
            return
        if page_result.get('unauthorized'):
            try:
                worker_api.patch_account_deauthorized(account_id)
            except Exception as exc:
                logger.error('[import_instagram_media] deauthorize failed: %s', exc)
            return
        if page_result.get('forbidden'):
            logger.warning('[import_instagram_media] forbidden account=%s', account_id)
            return
        raise self.retry(exc=RuntimeError(page_result.get('error', 'Graph error')), countdown=300) from None

    imported = 0
    for media in page_result.get('media') or []:
        mid = str(media.get('id') or '')
        if not mid:
            continue
        ts = str(media.get('timestamp') or '')
        created_at = ts.split('T')[0] if ts else datetime.now(timezone.utc).date().isoformat()
        insight_result = ig_analytics.fetch_media_insights(
            token,
            mid,
            provider=provider,
            fb_cfg=fb_cfg,
        )
        insights = insight_result.get('metrics') or {} if insight_result.get('ok') else {}
        metrics = _media_metrics(media, insights)
        worker_api.upsert_imported_post(
            account_id,
            mid,
            {
                'text': media.get('caption') or '',
                'created_at': created_at,
                'media_type': media.get('media_type'),
            },
            metrics,
        )
        imported += 1

    next_after = page_result.get('next_after') or ''
    if next_after and page + 1 < MAX_PAGES:
        celery_app.send_task(
            'tasks.imports.import_instagram_media',
            args=[account_id, next_after, page + 1],
        )
    else:
        celery_app.send_task('tasks.analytics.process_instagram_metrics', args=[account_id])

    logger.info('[import_instagram_media] account=%s imported=%s page=%s', account_id, imported, page)
