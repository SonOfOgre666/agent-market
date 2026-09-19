"""
Meta Marketing API read-only reporting (insights).

Campaign / ad set / ad / creative execution: registry tools + ``connectors.meta_ads.*`` — not duplicated here.
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, Optional, Union

import httpx

from .ads import list_ads as _connector_list_ads


def _norm_version(api_version: str) -> str:
    ver = (api_version or 'v22.0').strip()
    if not ver.startswith('v'):
        ver = f'v{ver}'
    return ver


def _safe_path_id(x: Any) -> str:
    s = str(x or '').strip()
    if not s or not re.match(r'^[a-zA-Z0-9_]+$', s):
        raise ValueError('Invalid id for Graph path')
    return s


def _clamp_limit(n: Any, default: int = 100) -> int:
    try:
        v = int(n)
    except (TypeError, ValueError):
        v = default
    return max(1, min(500, v))


def _graph_get(path: str, params: Dict[str, Any], api_version: str, *, timeout: float = 120.0) -> Dict[str, Any]:
    ver = _norm_version(api_version)
    url = f'https://graph.facebook.com/{ver}/{path.lstrip("/")}'
    resp = httpx.get(url, params=params, timeout=timeout)
    try:
        data = resp.json()
    except Exception:
        data = {}
    if resp.status_code >= 400:
        err = data.get('error') if isinstance(data, dict) else None
        msg = str(err.get('message') or resp.text or resp.reason_phrase) if isinstance(err, dict) else str(resp.text)
        raise ValueError(msg)
    if not isinstance(data, dict):
        return {}
    return data


def list_ads(
    access_token: str,
    *,
    api_version: str,
    ad_set_id: Optional[str] = None,
    campaign_id: Optional[str] = None,
    limit: int = 100,
    after: Optional[str] = None,
) -> Dict[str, Any]:
    """Delegates to ``connectors.meta_ads.ads.list_ads`` (reference get_ads)."""
    res = _connector_list_ads(
        access_token,
        campaign_id=str(campaign_id) if campaign_id else '',
        adset_id=str(ad_set_id) if ad_set_id else '',
        limit=_clamp_limit(limit),
        after=str(after) if after else '',
        api_version=api_version,
    )
    if not res.get('ok'):
        raise ValueError(res.get('error') or 'list ads failed')
    return {'data': list(res.get('data') or []), 'paging': res.get('paging')}


def get_insights(
    access_token: str,
    *,
    api_version: str,
    object_id: str = '',
    time_range: Union[str, Dict[str, Any], None] = None,
    breakdown: str = '',
    level: str = 'ad',
    limit: int = 25,
    after: str = '',
    action_attribution_windows: Optional[list] = None,
    action_breakdowns: Optional[list] = None,
    compact: bool = False,
    account_id: str = '',
    campaign_id: str = '',
    adset_id: str = '',
    ad_id: str = '',
) -> Dict[str, Any]:
    """Delegates to ``connectors.meta_ads.insights.get_insights`` (full reference parity)."""
    from .insights import get_insights as _get_insights_full

    out = _get_insights_full(
        access_token,
        object_id=object_id,
        time_range=time_range,
        breakdown=breakdown or '',
        level=level or 'ad',
        limit=limit,
        after=after or '',
        action_attribution_windows=action_attribution_windows,
        action_breakdowns=action_breakdowns,
        compact=compact,
        account_id=account_id,
        campaign_id=campaign_id,
        adset_id=adset_id,
        ad_id=ad_id,
        api_version=api_version,
    )
    if not out.get('ok'):
        raise ValueError(out.get('error') or 'insights request failed')
    return {'data': out.get('data') or [], 'paging': out.get('paging')}


def run_meta_ads_reporting(
    access_token: str,
    api_version: str,
    operation: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    """Returns Graph-shaped ``{ data, paging }``."""
    op = (operation or '').strip().lower()
    pl = payload or {}

    if op == 'ad_sets':
        raise ValueError(
            'Use tool meta_list_adsets (registry) — ad set listing is not duplicated in reporting',
        )

    if op == 'ads':
        raise ValueError('Use tool meta_list_ads (registry) — ad listing is not duplicated in reporting')

    if op == 'insights':
        return get_insights(
            access_token,
            api_version=api_version,
            object_id=str(pl.get('object_id') or ''),
            time_range=pl.get('time_range'),
            breakdown=str(pl.get('breakdown') or ''),
            level=str(pl.get('level') or 'ad'),
            limit=int(pl.get('limit') or 25),
            after=str(pl.get('after') or ''),
            action_attribution_windows=pl.get('action_attribution_windows'),
            action_breakdowns=pl.get('action_breakdowns'),
            compact=bool(pl.get('compact', False)),
            account_id=str(pl.get('account_id') or pl.get('ad_account_id') or ''),
            campaign_id=str(pl.get('campaign_id') or pl.get('platform_campaign_id') or ''),
            adset_id=str(pl.get('adset_id') or pl.get('ad_set_id') or pl.get('platform_ad_set_id') or ''),
            ad_id=str(pl.get('ad_id') or pl.get('platform_ad_id') or ''),
        )

    raise ValueError(f'Unknown meta reporting operation: {operation}')
