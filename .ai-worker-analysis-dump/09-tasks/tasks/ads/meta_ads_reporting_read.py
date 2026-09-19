"""P2: Meta Ads Graph reporting — ``/api/ads/meta/*`` read routes."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict

from celery_app import celery_app
from db import get_redis
from lib import worker_api
from tools.ads._errors import ToolValidationError
from tools.ads.registry import reporting_tool_id, run_ads_tool

logger = logging.getLogger(__name__)


@celery_app.task(name='tasks.ads.meta_ads_reporting_read', soft_time_limit=120, time_limit=150)
def meta_ads_reporting_read(
    workspace_id: str,
    account_id: str,
    operation: str,
    payload: Dict[str, Any],
    reply_key: str,
) -> None:
    r = get_redis()

    def write(ok: bool, data=None, error: str | None = None, status_code: int = 502) -> None:
        body = json.dumps({'ok': ok, 'data': data, 'error': error, 'status': status_code}, default=str)
        r.set(reply_key, body, ex=300)

    if not worker_api.configured():
        write(False, None, 'Worker API not configured', 503)
        return

    try:
        ctx = worker_api.get_account_worker_context(str(account_id))
    except Exception as exc:
        logger.exception('[meta_ads_reporting_read] context account=%s', account_id)
        write(False, None, str(exc), 502)
        return

    if not ctx:
        write(False, None, 'Account not found', 404)
        return

    if str(ctx.get('workspace_id') or '') != str(workspace_id):
        write(False, None, 'Forbidden', 403)
        return

    prov = str(ctx.get('provider') or '')
    if prov not in ('meta_ads', 'facebook'):
        write(False, None, 'Not a Meta Ads account', 422)
        return

    if not ctx.get('authorized'):
        write(False, None, 'Account not authorized', 401)
        return

    tool_id = reporting_tool_id('meta', operation)
    if not tool_id:
        write(False, None, f'Unknown meta reporting operation: {operation}', 400)
        return

    body = dict(payload or {})
    body['account_id'] = str(account_id)
    body['workspace_id'] = str(workspace_id)

    try:
        out = run_ads_tool(tool_id, body)
    except ToolValidationError as exc:
        msg = str(exc)
        sc = 422 if 'required' in msg.lower() or 'invalid' in msg.lower() else 400
        write(False, None, msg, sc)
        return
    except Exception as exc:
        logger.exception('[meta_ads_reporting_read] op=%s', operation)
        write(False, None, str(exc), 502)
        return

    if not out.get('ok'):
        write(False, None, out.get('error') or 'Reporting failed', 502)
        return

    result = out.get('result')
    if result is None and 'data' in out:
        result = {'data': out.get('data') or [], 'paging': out.get('paging')}
    write(True, {'result': result}, None, 200)
