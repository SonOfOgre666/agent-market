"""SEO rank checks — worker execution only."""

from __future__ import annotations

import logging
from typing import Any

from celery_app import celery_app
from lib.seo_serp import check_keyword_batch

logger = logging.getLogger(__name__)


@celery_app.task(name='tasks.seo.check_keyword_ranks')
def check_keyword_ranks(payload: dict | None = None) -> dict[str, Any]:
    body = payload or {}
    keywords = body.get('keywords') or []
    results = check_keyword_batch(keywords)
    return {'ok': True, 'results': results, 'count': len(results)}
