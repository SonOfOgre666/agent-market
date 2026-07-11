"""Persist AI provider call metrics to MongoDB via API (ai_executions collection)."""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from typing import Any, Iterator

from lib import worker_api
from lib.ai_workspace_config import OPCODE_TO_FEATURE

logger = logging.getLogger(__name__)

FEATURE_LABELS: dict[str, str] = {
    'planner': 'Planner',
    'post_generation': 'Post Gen',
    'image_generation': 'Image Gen',
    'video_generation': 'Video Gen',
    'image_script': 'Image Script',
    'video_script': 'Video Script',
    'google_search_marketing': 'Google Ads Marketing',
    'meta_ad_marketing': 'Meta Ads',
    'landing_page_copy': 'Landing Page',
    'key_test': 'Key Test',
}


def feature_label(feature_id: str | None, *, opcode: str | None = None) -> str:
    fid = (feature_id or '').strip()
    if not fid and opcode:
        fid = OPCODE_TO_FEATURE.get(opcode, opcode or '')
    return FEATURE_LABELS.get(fid, fid or 'AI')


def record_router_text_execution(
    provider: str,
    body: dict | None,
    opcode: str | None,
    usage: dict[str, Any],
    *,
    duration_ms: int,
    status: str = 'success',
    error: str | None = None,
) -> None:
    """Log a router opcode after API + JSON validation (single row per step attempt)."""
    b = body or {}
    fid = OPCODE_TO_FEATURE.get(opcode or '', '') or None
    record_execution(
        workspace_id=b.get('workspace_id'),
        provider=provider,
        model=b.get('ai_model'),
        api_model_id=b.get('api_model_id'),
        feature_id=fid,
        opcode=opcode,
        execution_type='text',
        input_tokens=usage.get('input_tokens'),
        output_tokens=usage.get('output_tokens'),
        total_tokens=usage.get('total_tokens'),
        duration_ms=duration_ms,
        status=status,
        error=error,
        source=b.get('execution_source'),
    )


def record_execution(
    *,
    workspace_id: str | None,
    provider: str | None,
    model: str | None,
    api_model_id: str | None = None,
    feature_id: str | None = None,
    opcode: str | None = None,
    execution_type: str = 'text',
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    total_tokens: int | None = None,
    duration_ms: int | None = None,
    status: str = 'success',
    error: str | None = None,
    source: str | None = None,
) -> None:
    if not workspace_id or not worker_api.configured():
        return
    fid = (feature_id or '').strip() or OPCODE_TO_FEATURE.get(opcode or '', '') or None
    body: dict[str, Any] = {
        'workspace_id': str(workspace_id),
        'feature_id': fid,
        'feature': feature_label(fid, opcode=opcode),
        'opcode': opcode,
        'provider': (provider or '').strip().lower() or None,
        'model': (model or '').strip() or None,
        'api_model_id': (api_model_id or '').strip() or None,
        'execution_type': execution_type,
        'input_tokens': input_tokens,
        'output_tokens': output_tokens,
        'total_tokens': total_tokens,
        'duration_ms': duration_ms,
        'status': 'failed' if status == 'failed' else 'success',
        'error': (error or '')[:2000] or None,
        'source': source,
    }
    try:
        worker_api.record_ai_execution(body)
    except Exception:
        logger.debug('ai execution log write failed', exc_info=True)


@contextmanager
def track_execution(
    *,
    workspace_id: str | None,
    provider: str | None,
    model: str | None,
    api_model_id: str | None = None,
    feature_id: str | None = None,
    opcode: str | None = None,
    execution_type: str = 'text',
    source: str | None = None,
) -> Iterator[dict[str, Any]]:
    """Context manager — set usage dict keys then log on exit."""
    usage: dict[str, Any] = {
        'input_tokens': None,
        'output_tokens': None,
        'total_tokens': None,
    }
    t0 = time.perf_counter()
    status = 'success'
    err_msg: str | None = None
    try:
        yield usage
    except Exception as exc:
        status = 'failed'
        err_msg = str(exc)
        raise
    finally:
        record_execution(
            workspace_id=workspace_id,
            provider=provider,
            model=model,
            api_model_id=api_model_id,
            feature_id=feature_id,
            opcode=opcode,
            execution_type=execution_type,
            input_tokens=usage.get('input_tokens'),
            output_tokens=usage.get('output_tokens'),
            total_tokens=usage.get('total_tokens'),
            duration_ms=int((time.perf_counter() - t0) * 1000),
            status=status,
            error=err_msg,
            source=source,
        )
