"""User-initiated workflow cancellation (Stop button)."""

from __future__ import annotations

import logging

from db import get_redis

logger = logging.getLogger(__name__)

_CANCEL_PREFIX = 'agentmarket:workflow_cancel:'
_CANCEL_TTL_SEC = 3600


def cancel_key(workflow_mongo_id: str) -> str:
    return f'{_CANCEL_PREFIX}{workflow_mongo_id}'


def is_workflow_cancelled(workflow_mongo_id: str | None) -> bool:
    if not workflow_mongo_id:
        return False
    try:
        r = get_redis()
        return bool(r.get(cancel_key(workflow_mongo_id)))
    except Exception:
        logger.exception('cancel check failed workflow_id=%s', workflow_mongo_id)
        return False


def clear_workflow_cancel(workflow_mongo_id: str | None) -> None:
    if not workflow_mongo_id:
        return
    try:
        get_redis().delete(cancel_key(workflow_mongo_id))
    except Exception:
        logger.exception('clear cancel failed workflow_id=%s', workflow_mongo_id)


def mark_workflow_cancelled(workflow_mongo_id: str) -> None:
    """Set cancel flag (API may set this before worker observes it)."""
    get_redis().set(cancel_key(workflow_mongo_id), '1', ex=_CANCEL_TTL_SEC)
