"""Celery entrypoint for Gemini — HTTP and prompts live in ``lib.llm.gemini``."""

from __future__ import annotations

import json
import logging
from typing import Any

from billiard.exceptions import SoftTimeLimitExceeded
from celery_app import celery_app
from db import get_redis
from lib.llm.router import dispatch as route_dispatch

logger = logging.getLogger(__name__)

# One provider API call per enqueue — never auto-retry expensive generation.
_AI_TASK_OPTS = dict(max_retries=0, acks_late=False)


def run_gemini_sync(opcode: str, payload: dict | None = None) -> dict[str, Any]:
    """Shared Gemini execution — UI (Celery) and agent (dispatcher) use this."""
    return route_dispatch(opcode, payload or {})


@celery_app.task(
    name='tasks.ai.gemini_sync',
    soft_time_limit=600,
    time_limit=660,
    **_AI_TASK_OPTS,
)
def gemini_sync(opcode: str, payload: dict, reply_key: str) -> None:
    r = get_redis()

    def write(ok: bool, data: Any = None, error: str | None = None, status: int = 502) -> None:
        body = json.dumps({'ok': ok, 'data': data, 'error': error, 'status': status}, default=str)
        r.set(reply_key, body, ex=300)

    try:
        out = run_gemini_sync(opcode, payload)
        write(True, out, None, 200)
    except SoftTimeLimitExceeded:
        logger.warning('gemini_sync timed out opcode=%s', opcode)
        write(False, None, 'AI generation timed out', 504)
        raise
    except ValueError as ve:
        msg = str(ve)
        status = 422 if ('start_date' in msg or 'end_date' in msg) and ('Invalid' in msg or 'before' in msg) else 400
        logger.info('gemini_sync validation: %s', ve)
        write(False, None, msg, status)
    except Exception as exc:
        logger.exception('gemini_sync failed opcode=%s', opcode)
        write(False, None, str(exc), 502)
