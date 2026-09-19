"""
Workspace ads sync: fetch remote campaigns via **connectors**, persist via **apps/api** internal routes.

Orchestration only — no platform HTTP in ``apps/api``.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any, Dict, List

from connectors import google_ads as google_ads_connector
from connectors import meta_ads as meta_ads_connector
from lib import worker_api
from tasks.ads._google_ads_config import merge_google_ads_credentials

logger = logging.getLogger(__name__)


def execute_workspace_ads_sync(workspace_id: str) -> Dict[str, Any]:
    wid = str(workspace_id)
    if not worker_api.configured():
        logger.warning('[sync_workspace_ads] WORKER_API_SECRET not set — skipped workspace=%s', wid)
        return {'ok': False, 'google': 0, 'meta': 0}

    ctx = worker_api.get_ads_sync_workspace_context(wid)
    google_rows: List[Dict[str, Any]] = []
    meta_rows: List[Dict[str, Any]] = []

    ga = ctx.get('google_account') or {}
    if ga.get('authorized') and ga.get('provider') == 'google_ads' and google_ads_connector.health_check():
        cust_id = (ga.get('data') or {}).get('customer_id')
        refresh = (ga.get('access_token') or {}).get('refresh_token')
        gsvc = merge_google_ads_credentials(dict(ctx.get('google_service') or {}))
        dev, cid, csec = gsvc.get('developer_token'), gsvc.get('client_id'), gsvc.get('client_secret')
        if cust_id and refresh and dev and cid and csec:
            gcfg: Dict[str, Any] = {
                'developer_token': dev,
                'client_id': cid,
                'client_secret': csec,
                'refresh_token': refresh,
                'use_proto_plus': True,
            }
            login_cid = (ga.get('data') or {}).get('login_customer_id') or os.getenv(
                'GOOGLE_ADS_LOGIN_CUSTOMER_ID'
            )
            login_digits = re.sub(r'\D', '', str(login_cid or ''))
            cust_digits = re.sub(r'\D', '', str(cust_id or ''))
            if login_digits and login_digits != cust_digits:
                gcfg['login_customer_id'] = login_digits
            try:
                google_rows = google_ads_connector.fetch_campaign_sync_rows(gcfg, str(cust_id))
            except Exception as exc:
                logger.exception('[sync_workspace_ads] google fetch failed workspace=%s: %s', wid, exc)

    ma = ctx.get('meta_account') or {}
    if ma.get('authorized') and ma.get('provider') in ('meta_ads', 'facebook'):
        tok = (ma.get('access_token') or {}).get('token') or (ma.get('data') or {}).get('user_token')
        act = (ma.get('data') or {}).get('ad_account_id')
        if tok and act:
            cfg = ctx.get('facebook_service') or {}
            api_ver = str(cfg.get('api_version') or 'v22.0')
            if not api_ver.startswith('v'):
                api_ver = f'v{api_ver}'
            try:
                meta_rows = meta_ads_connector.fetch_campaigns_for_ad_account(
                    str(tok),
                    ad_account_id=str(act),
                    api_version=api_ver,
                )
            except Exception as exc:
                logger.exception('[sync_workspace_ads] meta fetch failed workspace=%s: %s', wid, exc)

    try:
        return worker_api.apply_ads_workspace_sync(wid, google_rows, meta_rows)
    except Exception as exc:
        logger.exception('[sync_workspace_ads] apply failed workspace=%s: %s', wid, exc)
        raise
