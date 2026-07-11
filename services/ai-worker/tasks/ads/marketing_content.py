"""Celery tasks for ads marketing content (keywords, RSA assets, landing pages)."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from celery_app import celery_app
from db import get_redis
from lib.ads_marketing_content import (
    generate_campaign_search_assets,
    generate_landing_page_marketing_content,
    suggest_keywords_for_topic,
)

logger = logging.getLogger(__name__)


def _write_reply(reply_key: Optional[str], body: Dict[str, Any]) -> None:
    if not reply_key:
        return
    ok = bool(body.get('ok', True))
    status = 422 if not ok else 200
    r = get_redis()
    r.set(
        reply_key,
        json.dumps(
            {
                'ok': ok,
                'data': body if ok else None,
                'error': body.get('error') if not ok else None,
                'status': status,
            },
            default=str,
        ),
        ex=300,
    )


@celery_app.task(name='tasks.ads.suggest_keywords', soft_time_limit=120, time_limit=150)
def suggest_keywords(
    topic: str,
    country: str = 'US',
    language: str = 'en',
    workspace_id: str | None = None,
    account_id: str | None = None,
    page_url: str | None = None,
    reply_key: Optional[str] = None,
) -> Dict[str, Any] | None:
    out = suggest_keywords_for_topic(
        topic=topic,
        country=country,
        language=language,
        workspace_id=workspace_id,
        account_id=account_id,
        page_url=page_url,
    )
    if reply_key:
        _write_reply(reply_key, out)
        return None
    return out
