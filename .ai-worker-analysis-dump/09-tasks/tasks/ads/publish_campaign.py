"""
Publish ads campaign: Python-only (native Google Ads when ``google-ads`` is installed).

There is **no** Node worker fallback. Install ``google-ads`` in ai-worker or fix credentials.
"""

import logging

from bson import ObjectId
from bson.errors import InvalidId

from celery_app import celery_app
from lib import worker_api

from .publish_campaign_native import GoogleAdsLibraryMissing, run_native_publish_campaign

logger = logging.getLogger(__name__)


def _mark_google_ads_lib_missing(campaign_id: str) -> None:
    if not worker_api.configured():
        logger.error('[publish_campaign] WORKER_API_SECRET not set — cannot record publish error for %s', campaign_id)
        return
    try:
        ObjectId(campaign_id)
    except InvalidId:
        return
    msg = 'Install the google-ads package in services/ai-worker (see requirements.txt). Node publish proxy removed.'
    try:
        worker_api.append_campaign_publish_error(campaign_id, msg)
    except Exception as exc:
        logger.error('[publish_campaign] append error failed: %s', exc)


@celery_app.task(name='tasks.ads.publish_campaign')
def publish_campaign(campaign_id: str):
    try:
        run_native_publish_campaign(campaign_id)
    except GoogleAdsLibraryMissing:
        logger.error('[publish_campaign] google-ads not installed campaign_id=%s', campaign_id)
        _mark_google_ads_lib_missing(campaign_id)
        raise RuntimeError(
            'google-ads is not installed in the ai-worker environment. pip install -r requirements.txt',
        ) from None
