"""Celery entrypoint for ads tools — same execution path for UI, agents, workflows."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from celery_app import celery_app
from db import get_redis
from tools.ads._errors import ToolValidationError
from tools.ads.registry import run_ads_tool

logger = logging.getLogger(__name__)


def run_execute_ads_tool(tool_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        return run_ads_tool(tool_id, payload or {})
    except ToolValidationError as exc:
        return {'ok': False, 'error': str(exc)}
    except Exception as exc:
        logger.exception('[execute_ads_tool] tool_id=%s', tool_id)
        return {'ok': False, 'error': str(exc)}


@celery_app.task(name='tasks.ads.execute_ads_tool', soft_time_limit=180, time_limit=210)
def execute_ads_tool(
    tool_id: str,
    payload: Dict[str, Any] | None = None,
    reply_key: Optional[str] = None,
) -> Dict[str, Any] | None:
    out = run_execute_ads_tool(tool_id, payload or {})
    if not reply_key:
        return out

    r = get_redis()
    ok = bool(out.get('ok')) if isinstance(out, dict) and 'ok' in out else not (isinstance(out, dict) and out.get('error'))
    status = 422 if not ok and isinstance(out, dict) and out.get('error') else 200
    # Always attach full tool payload as ``data`` so failures can carry hints (e.g. ``accessible_accounts``).
    body = json.dumps(
        {
            'ok': ok,
            'data': out if isinstance(out, dict) else None,
            'error': (out.get('error') if isinstance(out, dict) else None) if not ok else None,
            'status': status if not ok else 200,
        },
        default=str,
    )
    r.set(reply_key, body, ex=300)
    return None
