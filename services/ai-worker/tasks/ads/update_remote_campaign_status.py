"""P2: Google Ads remote campaign status (PATCH campaign body.status → platform)."""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict

from celery_app import celery_app
from connectors import google_ads as google_ads_connector
from db import get_redis
from lib import worker_api

from ._google_ads_config import merge_google_ads_credentials

logger = logging.getLogger(__name__)

GoogleAdsException = google_ads_connector.GoogleAdsException
GoogleAdsLibraryMissing = google_ads_connector.GoogleAdsLibraryMissing


@celery_app.task(name='tasks.ads.update_remote_campaign_status', soft_time_limit=90, time_limit=120)
def update_remote_campaign_status(
    workspace_id: str,
    account_id: str,
    platform_campaign_id: str,
    status: str,
    reply_key: str,
) -> None:
    r = get_redis()

    def write(ok: bool, data=None, error: str | None = None, status_code: int = 502) -> None:
        body = json.dumps({'ok': ok, 'data': data, 'error': error, 'status': status_code}, default=str)
        r.set(reply_key, body, ex=300)

    if not worker_api.configured():
        logger.warning('[update_remote_campaign_status] worker_api not configured')
        write(False, None, 'Worker API not configured', 503)
        return

    if not google_ads_connector.health_check():
        write(False, None, 'google-ads library not installed in worker', 500)
        return

    try:
        ctx = worker_api.get_account_worker_context(str(account_id))
    except Exception as exc:
        logger.exception('[update_remote_campaign_status] context account=%s', account_id)
        write(False, None, str(exc), 502)
        return

    if not ctx:
        write(False, None, 'Account not found', 404)
        return

    if str(ctx.get('workspace_id') or '') != str(workspace_id):
        write(False, None, 'Forbidden', 403)
        return

    if str(ctx.get('provider') or '') != 'google_ads':
        write(False, None, 'Not a Google Ads account', 422)
        return

    if not ctx.get('authorized'):
        write(False, None, 'Account not authorized', 401)
        return

    svc_row = merge_google_ads_credentials(dict(worker_api.get_service_decrypted('google_ads', str(workspace_id)) or {}))
    refresh = (ctx.get('access_token') or {}).get('refresh_token')
    dev = svc_row.get('developer_token')
    client_id = svc_row.get('client_id')
    client_secret = svc_row.get('client_secret')
    if not refresh:
        write(False, None, 'No refresh token — please reconnect Google Ads', 400)
        return
    if not dev or not client_id or not client_secret:
        write(False, None, 'Google Ads API credentials not configured', 500)
        return

    raw_cid = (ctx.get('data') or {}).get('customer_id')
    customer_id = google_ads_connector.digits_customer_id(raw_cid)
    if not customer_id:
        write(False, None, 'No Google Ads customer ID. Reconnect the Google Ads account.', 400)
        return

    gcfg: Dict[str, Any] = {
        'developer_token': dev,
        'client_id': client_id,
        'client_secret': client_secret,
        'refresh_token': refresh,
        'use_proto_plus': True,
    }
    login_cid = (ctx.get('data') or {}).get('login_customer_id') or os.getenv('GOOGLE_ADS_LOGIN_CUSTOMER_ID')
    login_digits = re.sub(r'\D', '', str(login_cid or ''))
    if login_digits and login_digits != customer_id:
        gcfg['login_customer_id'] = login_digits

    try:
        google_ads_connector.mutate_update_campaign_status(
            gcfg,
            customer_id,
            str(platform_campaign_id),
            str(status or ''),
        )
    except GoogleAdsLibraryMissing as exc:
        write(False, None, str(exc), 500)
        return
    except GoogleAdsException as exc:  # type: ignore[misc]
        parts = []
        failure = getattr(exc, 'failure', None)
        for err in getattr(failure, 'errors', []) or []:
            parts.append(getattr(err, 'message', str(err)))
        msg = parts[0] if parts else str(exc)
        write(False, None, msg, 502)
        return
    except ValueError as exc:
        write(False, None, str(exc), 400)
        return
    except Exception as exc:
        logger.exception('[update_remote_campaign_status] mutate failed')
        write(False, None, str(exc), 502)
        return

    write(True, {'updated': True}, None, 200)
