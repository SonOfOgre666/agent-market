"""P2: Graph ``me/accounts`` for ads page picker — execution in worker (connector), API validates + enqueues."""

from __future__ import annotations

import json
import logging

from celery_app import celery_app
from connectors import facebook as facebook_connector
from db import get_redis
from lib import worker_api

logger = logging.getLogger(__name__)


@celery_app.task(name='tasks.ads.fetch_facebook_pages', soft_time_limit=90, time_limit=120)
def fetch_facebook_pages(account_id: str, workspace_id: str, reply_key: str) -> None:
    r = get_redis()

    def write(ok: bool, data=None, error: str | None = None, status: int = 502) -> None:
        body = json.dumps({'ok': ok, 'data': data, 'error': error, 'status': status}, default=str)
        r.set(reply_key, body, ex=300)

    if not worker_api.configured():
        logger.warning('[fetch_facebook_pages] worker_api not configured')
        write(False, None, 'Worker API not configured', 503)
        return

    try:
        ctx = worker_api.get_account_worker_context(str(account_id))
    except Exception as exc:
        logger.exception('[fetch_facebook_pages] worker-context account=%s', account_id)
        write(False, None, str(exc), 502)
        return

    if not ctx:
        write(False, None, 'Account not found', 404)
        return

    if str(ctx.get('workspace_id') or '') != str(workspace_id):
        write(False, None, 'Forbidden', 403)
        return

    if not ctx.get('authorized'):
        write(False, None, 'Account not authorized', 401)
        return

    token = (ctx.get('data') or {}).get('user_token') or (ctx.get('access_token') or {}).get('token')
    if not token:
        write(False, None, 'No user token on this account. Reconnect it.', 400)
        return

    try:
        fb_cfg = worker_api.get_service_decrypted('facebook', str(workspace_id))
    except Exception as exc:
        logger.warning('[fetch_facebook_pages] service config: %s', exc)
        fb_cfg = {}

    api_version = (fb_cfg or {}).get('api_version') or 'v22.0'
    out = facebook_connector.fetch_me_accounts(str(token), api_version=str(api_version), timeout=60.0)

    if out.get('ok'):
        write(True, {'pages': out.get('pages') or []}, None, 200)
        return

    status = int(out.get('http_status') or 502)
    if status < 400 or status >= 600:
        status = 502
    write(False, None, str(out.get('error') or 'Graph request failed'), status)
