"""
Schedule an existing draft post — registry implementation (Rules/PROJECT_PATTERN).

Persistence runs in API (schedulePostForWorkspace) via worker internal route.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from celery_app import celery_app
from db import get_redis
from lib import worker_api

logger = logging.getLogger(__name__)


def run_schedule_post(payload: dict[str, Any]) -> dict[str, Any]:
    if not worker_api.configured():
        raise RuntimeError('WORKER_API_SECRET / INTERNAL_API_URL not configured')
    post_id = str(payload.get('post_id') or '').strip()
    if not post_id:
        raise ValueError('post_id is required')
    if not payload.get('workspace_id'):
        raise ValueError('workspace_id is required')
    if not payload.get('scheduled_at') and not payload.get('schedule_in_minutes'):
        raise ValueError('scheduled_at or schedule_in_minutes is required')
    return worker_api.schedule_post(payload)


@celery_app.task(name='tasks.social.schedule_post', soft_time_limit=120, time_limit=150)
def schedule_post(payload: dict, reply_key: str | None = None) -> dict[str, Any] | None:
    r = get_redis()

    def write(ok: bool, data: Any = None, error: str | None = None, status: int = 502) -> None:
        if not reply_key:
            return
        body = json.dumps({'ok': ok, 'data': data, 'error': error, 'status': status}, default=str)
        r.set(reply_key, body, ex=300)

    try:
        out = run_schedule_post(payload or {})
        write(True, out, None, 200)
        return out
    except ValueError as ve:
        logger.info('schedule_post validation: %s', ve)
        write(False, None, str(ve), 422)
        raise
    except Exception as exc:
        logger.exception('schedule_post failed')
        write(False, None, str(exc), 502)
        raise
