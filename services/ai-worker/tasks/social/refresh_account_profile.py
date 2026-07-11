"""P2: refresh linked account profile (Graph / APIs) — replaces ``PUT /api/accounts/:id`` in-process ``getAccount``."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict

from celery_app import celery_app
from connectors import account_profile
from db import get_redis
from lib import worker_api

from ..ads._google_ads_config import merge_google_ads_credentials

logger = logging.getLogger(__name__)


@celery_app.task(name='tasks.social.refresh_account_profile', soft_time_limit=90, time_limit=120)
def refresh_account_profile(account_id: str, workspace_id: str, reply_key: str) -> None:
    r = get_redis()

    def write(ok: bool, data=None, error: str | None = None, status: int = 502) -> None:
        body = json.dumps({'ok': ok, 'data': data, 'error': error, 'status': status}, default=str)
        r.set(reply_key, body, ex=300)

    if not worker_api.configured():
        write(False, None, 'Worker API not configured', 503)
        return

    try:
        ctx = worker_api.get_account_worker_context(str(account_id))
    except Exception as exc:
        logger.exception('[refresh_account_profile] context account=%s', account_id)
        write(False, None, str(exc), 502)
        return

    if not ctx:
        write(False, None, 'Account not found', 404)
        return

    if str(ctx.get('workspace_id') or '') != str(workspace_id):
        write(False, None, 'Forbidden', 403)
        return

    wid = str(workspace_id)
    try:
        configs: Dict[str, Dict[str, Any]] = {
            'twitter': dict(worker_api.get_service_decrypted('twitter', wid) or {}),
            'linkedin': dict(worker_api.get_service_decrypted('linkedin', wid) or {}),
            'facebook': dict(worker_api.get_service_decrypted('facebook', wid) or {}),
            'tiktok': dict(worker_api.get_service_decrypted('tiktok', wid) or {}),
            'google_ads': merge_google_ads_credentials(dict(worker_api.get_service_decrypted('google_ads', wid) or {})),
            'instagram_login': dict(worker_api.get_service_decrypted('instagram_login', wid) or {}),
        }
    except Exception as exc:
        logger.warning('[refresh_account_profile] service configs: %s', exc)
        configs = {}

    out = account_profile.fetch_profile_snapshot(ctx, configs)
    if not out.get('ok'):
        write(False, None, str(out.get('error') or 'Profile refresh failed'), 502)
        return

    body = {
        'name': out.get('name'),
        'username': out.get('username'),
        'media': out.get('media') or {},
        'data': out.get('data') or {},
    }
    write(True, body, None, 200)
