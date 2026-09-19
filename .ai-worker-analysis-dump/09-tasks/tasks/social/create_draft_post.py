"""
Create a draft or scheduled post — registry implementation (Rules/PROJECT_PATTERN).

Persistence runs in API (services/postCreate.js) via worker internal route.
UI and agent both resolve to this task through the dispatcher / API enqueue.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from celery_app import celery_app
from db import get_redis
from lib import worker_api

logger = logging.getLogger(__name__)


def run_create_draft_post(payload: dict[str, Any]) -> dict[str, Any]:
    if not worker_api.configured():
        raise RuntimeError('WORKER_API_SECRET / INTERNAL_API_URL not configured')
    if not payload.get('workspace_id'):
        raise ValueError('workspace_id is required')
    return worker_api.create_post(payload)


@celery_app.task(name='tasks.social.create_draft_post', soft_time_limit=120, time_limit=150)
def create_draft_post(payload: dict, reply_key: str | None = None) -> dict[str, Any] | None:
    r = get_redis()

    def write(ok: bool, data: Any = None, error: str | None = None, status: int = 502) -> None:
        if not reply_key:
            return
        body = json.dumps({'ok': ok, 'data': data, 'error': error, 'status': status}, default=str)
        r.set(reply_key, body, ex=300)

    try:
        out = run_create_draft_post(payload or {})
        write(True, out, None, 200)
        return out
    except ValueError as ve:
        logger.info('create_draft_post validation: %s', ve)
        write(False, None, str(ve), 422)
        raise
    except Exception as exc:
        logger.exception('create_draft_post failed')
        write(False, None, str(exc), 502)
        raise
