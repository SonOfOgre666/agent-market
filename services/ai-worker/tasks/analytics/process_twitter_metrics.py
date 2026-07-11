"""Parity with apps/api/src/jobs/ProcessTwitterMetrics.js — aggregate imported_posts into metrics (reads + writes via API)."""

import logging

from bson import ObjectId
from bson.errors import InvalidId

from celery_app import celery_app
from lib import worker_api

logger = logging.getLogger(__name__)


@celery_app.task(name='tasks.analytics.process_twitter_metrics')
def process_twitter_metrics(account_id: str):
    try:
        ObjectId(account_id)
    except InvalidId:
        logger.warning('Invalid account_id: %s', account_id)
        return

    if not worker_api.configured():
        logger.warning('[process_twitter_metrics] WORKER_API_SECRET not set — skipped')
        return

    rows = worker_api.get_imported_posts_twitter_aggregate(account_id)
    items = []
    for row in rows:
        day = row.get('date')
        if not day:
            continue
        items.append(
            {
                'account_id': account_id,
                'date': day,
                'data': {
                    'likes': row.get('likes') or 0,
                    'replies': row.get('replies') or 0,
                    'retweets': row.get('retweets') or 0,
                    'impressions': row.get('impressions') or 0,
                },
            }
        )
    if items:
        worker_api.bulk_upsert_metrics(items)
    logger.info('[process_twitter_metrics] account=%s days=%s', account_id, len(rows))
