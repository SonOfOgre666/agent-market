"""P2: Meta ``me/adaccounts`` for workspace ad-account picker (facebook/instagram linked accounts)."""

from __future__ import annotations

import json
import logging
from typing import Dict, List

from celery_app import celery_app
from connectors import meta_ads as meta_ads_connector
from db import get_redis
from lib import worker_api

logger = logging.getLogger(__name__)


def _fallback_row(account_id: str, account_name: str) -> Dict[str, Any]:
    return {
        'account_id': str(account_id),
        'account_name': str(account_name or ''),
        'provider': 'facebook',
        'ad_account_id': None,
        'ad_account_name': None,
        'needs_reconnect': False,
    }


@celery_app.task(name='tasks.ads.fetch_meta_ad_accounts_bundle', soft_time_limit=180, time_limit=210)
def fetch_meta_ad_accounts_bundle(workspace_id: str, account_ids: List[str], reply_key: str) -> None:
    r = get_redis()

    def write(ok: bool, data=None, error: str | None = None, status: int = 502) -> None:
        body = json.dumps({'ok': ok, 'data': data, 'error': error, 'status': status}, default=str)
        r.set(reply_key, body, ex=300)

    if not worker_api.configured():
        logger.warning('[fetch_meta_ad_accounts_bundle] worker_api not configured')
        write(False, None, 'Worker API not configured', 503)
        return

    ids = [str(x) for x in (account_ids or []) if x]
    if not ids:
        write(True, {'rows': []}, None, 200)
        return

    rows_out: List[Dict[str, Any]] = []
    wid = str(workspace_id)

    try:
        fb_cfg = worker_api.get_service_decrypted('facebook', wid)
    except Exception as exc:
        logger.warning('[fetch_meta_ad_accounts_bundle] facebook config: %s', exc)
        fb_cfg = {}

    api_version = (fb_cfg or {}).get('api_version') or 'v22.0'

    for aid in ids:
        try:
            ctx = worker_api.get_account_worker_context(aid)
        except Exception as exc:
            logger.exception('[fetch_meta_ad_accounts_bundle] context account=%s', aid)
            rows_out.append(_fallback_row(aid, ''))
            continue

        if not ctx:
            rows_out.append(_fallback_row(aid, ''))
            continue

        if str(ctx.get('workspace_id') or '') != wid:
            continue

        prov = str(ctx.get('provider') or '')
        if prov not in ('facebook', 'instagram'):
            continue

        name = str(ctx.get('name') or '')
        token = (ctx.get('data') or {}).get('user_token') or (ctx.get('access_token') or {}).get('token')
        if not token:
            continue

        out = meta_ads_connector.fetch_me_adaccounts(str(token), api_version=str(api_version), timeout=120.0)
        if not out.get('ok'):
            rows_out.append(_fallback_row(aid, name))
            continue

        for ad in out.get('accounts') or []:
            rows_out.append(
                {
                    'account_id': aid,
                    'account_name': name,
                    'provider': 'facebook',
                    'ad_account_id': ad.get('id'),
                    'ad_account_name': ad.get('name'),
                    'currency': ad.get('currency'),
                    'status_label': ad.get('status_label'),
                    'needs_reconnect': False,
                }
            )

    write(True, {'rows': rows_out}, None, 200)
