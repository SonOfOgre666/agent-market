"""Resolve account credentials into ads tool payloads (worker-side)."""

from __future__ import annotations

import logging
import os
import re
from typing import Any, Dict

from lib import worker_api

logger = logging.getLogger(__name__)


def inherit_ads_account_context(
    payload: Dict[str, Any] | None,
    *,
    workflow: Dict[str, Any] | None = None,
    steps: list[Dict[str, Any]] | None = None,
) -> Dict[str, Any]:
    """
    Copy ``account_id`` onto a step payload when the planner only set it on step_1.

    LLM-planned Google/Meta graphs often omit account_id on later steps; credential
    enrichment requires it on every ads tool call.
    """
    body = dict(payload or {})
    if str(body.get('account_id') or '').strip():
        return body

    wf = workflow if isinstance(workflow, dict) else {}
    for key in ('google_account_id', 'meta_account_id', 'account_id'):
        aid = str(wf.get(key) or '').strip()
        if aid:
            body['account_id'] = aid
            return body

    for step in steps or []:
        if not isinstance(step, dict):
            continue
        sp = step.get('payload')
        if isinstance(sp, dict):
            aid = str(sp.get('account_id') or '').strip()
            if aid:
                body['account_id'] = aid
                return body
    return body


def enrich_ads_tool_payload(tool_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Fill access tokens / Google client config when ``account_id`` is provided.
    Idempotent when credentials are already present.
    """
    body = dict(payload or {})
    account_id = str(body.get('account_id') or '').strip()
    if not account_id:
        return body

    if body.get('access_token') and tool_id.startswith('google_'):
        if body.get('google_ads_client_config'):
            return body
    elif body.get('access_token') and tool_id.startswith('meta_'):
        return body

    if not worker_api.configured():
        return body

    try:
        ctx = worker_api.get_account_worker_context(account_id)
    except Exception as exc:
        logger.warning('[ads._resolve] account context failed: %s', exc)
        return body

    account = ctx if isinstance(ctx, dict) and ctx.get('provider') else (ctx.get('account') or {})
    if not account.get('authorized'):
        return body

    provider = str(account.get('provider') or '')

    if tool_id.startswith('meta_'):
        token = (account.get('access_token') or {}).get('token') or (account.get('data') or {}).get('user_token')
        if token and not body.get('access_token'):
            body['access_token'] = str(token)
        if not body.get('api_version'):
            wid = account.get('workspace_id') or body.get('workspace_id')
            try:
                fb_cfg = worker_api.get_service_decrypted('facebook', str(wid) if wid else None)
            except Exception:
                fb_cfg = {}
            body['api_version'] = (fb_cfg or {}).get('api_version') or 'v22.0'
        if not body.get('ad_account_id'):
            ad_act = (account.get('data') or {}).get('ad_account_id')
            if ad_act:
                body['ad_account_id'] = str(ad_act)

    if tool_id.startswith('google_') and not body.get('google_ads_client_config'):
        from tasks.ads._google_ads_config import merge_google_ads_credentials

        wid = account.get('workspace_id') or body.get('workspace_id')
        svc = worker_api.get_service_decrypted('google_ads', str(wid) if wid else None)
        cfg = merge_google_ads_credentials(dict(svc or {}))
        refresh = (account.get('access_token') or {}).get('refresh_token')
        if provider == 'google_ads' and refresh and cfg.get('developer_token'):
            gcfg: Dict[str, Any] = {
                'developer_token': cfg.get('developer_token'),
                'client_id': cfg.get('client_id'),
                'client_secret': cfg.get('client_secret'),
                'refresh_token': refresh,
                'use_proto_plus': True,
            }
            login_cid = (account.get('data') or {}).get('login_customer_id') or os.getenv(
                'GOOGLE_ADS_LOGIN_CUSTOMER_ID'
            )
            login_digits = re.sub(r'\D', '', str(login_cid or ''))
            cust_digits = re.sub(r'\D', '', str((account.get('data') or {}).get('customer_id') or ''))
            if login_digits and login_digits != cust_digits:
                gcfg['login_customer_id'] = login_digits
            body['google_ads_client_config'] = gcfg
        if not body.get('customer_id'):
            cid = (account.get('data') or {}).get('customer_id')
            if cid:
                body['customer_id'] = re.sub(r'\D', '', str(cid))
            elif provider == 'google_ads' and refresh and cfg.get('developer_token'):
                try:
                    from connectors.google_ads.accounts import fetch_accessible_accounts

                    listed = fetch_accessible_accounts(gcfg)
                    accounts = listed.get('accounts') or []
                    if listed.get('ok') and len(accounts) == 1:
                        body['customer_id'] = re.sub(
                            r'\D',
                            '',
                            str(accounts[0].get('customer_id') or accounts[0].get('id') or ''),
                        )
                except Exception as exc:
                    logger.warning('[ads._resolve] google customer discovery failed: %s', exc)

    return body
