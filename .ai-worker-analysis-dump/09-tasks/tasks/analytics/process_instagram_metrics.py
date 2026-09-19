"""Aggregate ``imported_posts`` Instagram media metrics into ``metrics`` (likes, comments)."""

import logging
from collections import defaultdict

from bson import ObjectId
from bson.errors import InvalidId

from celery_app import celery_app
from lib import worker_api

logger = logging.getLogger(__name__)


@celery_app.task(name='tasks.analytics.process_instagram_metrics')
def process_instagram_metrics(account_id: str):
    try:
        ObjectId(account_id)
    except InvalidId:
        logger.warning('Invalid account_id: %s', account_id)
        return

    if not worker_api.configured():
        logger.warning('[process_instagram_metrics] WORKER_API_SECRET not set — skipped')
        return

    rows = worker_api.get_imported_posts_instagram_aggregate(account_id)
    by_day: dict = defaultdict(lambda: {'likes': 0, 'comments': 0, 'views': 0})
    for row in rows:
        day = row.get('date')
        if not day:
            continue
        by_day[day]['likes'] += int(row.get('likes') or 0)
        by_day[day]['comments'] += int(row.get('comments') or 0)
        by_day[day]['views'] += int(row.get('views') or 0)

    items = []
    for day, data in sorted(by_day.items()):
        if not any(data.values()):
            continue
        items.append({
            'account_id': account_id,
            'date': day,
            'data': data,
            'merge': True,
        })

    if items:
        worker_api.bulk_upsert_metrics(items)
    logger.info('[process_instagram_metrics] account=%s days=%s', account_id, len(items))
