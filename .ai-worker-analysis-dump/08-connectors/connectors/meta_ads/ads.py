"""Meta Ads ad reads and mutations — parity with reference_ads/meta_ads/ads.py (no MCP)."""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

from .api import GraphAPIError, format_graph_error, graph_request
from .utils import ensure_act_prefix

AD_LIST_FIELDS = (
    'id,name,adset_id,campaign_id,status,effective_status,issues_info,creative,'
    'created_time,updated_time,bid_amount,conversion_domain,tracking_specs'
)

AD_DETAIL_FIELDS = (
    f'{AD_LIST_FIELDS},preview_shareable_link'
)


def _safe_graph_id(x: str) -> str:
    s = str(x or '').strip().lstrip('/')
    if not s or not re.match(r'^[a-zA-Z0-9_]+$', s):
        raise ValueError('Invalid id for Graph path')
    return s


def list_ads(
    access_token: str,
    *,
    account_id: str = '',
    campaign_id: str = '',
    adset_id: str = '',
    limit: int = 50,
    after: str = '',
    api_version: str = 'v22.0',
    timeout: float = 120.0,
) -> Dict[str, Any]:
    """List ads — reference ``get_ads``."""
    if not access_token:
        return {'ok': False, 'error': 'access_token is required', 'data': [], 'paging': None}
    if adset_id:
        endpoint = f'{_safe_graph_id(adset_id)}/ads'
    elif campaign_id:
        endpoint = f'{_safe_graph_id(campaign_id)}/ads'
    elif account_id:
        endpoint = f'{ensure_act_prefix(account_id)}/ads'
    else:
        return {'ok': False, 'error': 'account_id, campaign_id, or adset_id is required', 'data': [], 'paging': None}

    params: Dict[str, Any] = {
        'fields': AD_LIST_FIELDS,
        'limit': str(max(1, min(500, int(limit)))),
    }
    if after:
        params['after'] = str(after)

    try:
        data = graph_request(endpoint, access_token, params=params, method='GET', api_version=api_version, timeout=timeout)
    except GraphAPIError as exc:
        err = exc.error_data if isinstance(exc.error_data, dict) else {'message': str(exc)}
        return {'ok': False, 'error': format_graph_error(err), 'data': [], 'paging': None}
    if data.get('ok') is False:
        return {**data, 'data': [], 'paging': None}
    if isinstance(data, dict) and 'error' in data:
        err = data['error']
        return {
            'ok': False,
            'error': format_graph_error(err) if isinstance(err, dict) else str(err),
            'data': [],
            'paging': None,
        }
    return {'ok': True, 'data': data.get('data') or [], 'paging': data.get('paging')}


def get_ad_details(
    access_token: str,
    *,
    ad_id: str,
    api_version: str = 'v22.0',
    timeout: float = 120.0,
) -> Dict[str, Any]:
    """GET ad — reference ``get_ad_details``."""
    if not ad_id:
        return {'ok': False, 'error': 'ad_id is required'}
    aid = _safe_graph_id(ad_id)
    try:
        data = graph_request(
            aid,
            access_token,
            params={'fields': AD_DETAIL_FIELDS},
            method='GET',
            api_version=api_version,
            timeout=timeout,
        )
    except GraphAPIError as exc:
        err = exc.error_data if isinstance(exc.error_data, dict) else {'message': str(exc)}
        return {'ok': False, 'error': format_graph_error(err)}
    if data.get('ok') is False:
        return data
    if isinstance(data, dict) and 'error' in data:
        err = data['error']
        return {'ok': False, 'error': format_graph_error(err) if isinstance(err, dict) else str(err)}
    return {'ok': True, 'ad': dict(data) if isinstance(data, dict) else {}}


def create_ad(
    access_token: str,
    *,
    account_id: str,
    name: str,
    adset_id: str,
    creative_id: str,
    status: str = 'PAUSED',
    bid_amount: Optional[int] = None,
    tracking_specs: Optional[List[Dict[str, Any]]] = None,
    api_version: str = 'v22.0',
) -> Dict[str, Any]:
    """POST ad — reference ``create_ad``."""
    if not account_id or not name or not adset_id or not creative_id:
        return {'ok': False, 'error': 'account_id, name, adset_id, and creative_id are required'}

    params: Dict[str, Any] = {
        'name': name,
        'adset_id': str(adset_id),
        'creative': {'creative_id': str(creative_id)},
        'status': status or 'PAUSED',
    }
    if bid_amount is not None:
        params['bid_amount'] = str(bid_amount)
    if tracking_specs is not None:
        params['tracking_specs'] = tracking_specs

    data = graph_request(
        f'{ensure_act_prefix(account_id)}/ads',
        access_token,
        params=params,
        method='POST',
        api_version=api_version,
    )
    if data.get('ok') is False:
        return data
    if 'error' in data:
        err = data['error']
        return {'ok': False, 'error': format_graph_error(err), 'error_data': err}

    ad_id = data.get('id')
    if not ad_id:
        return {'ok': False, 'error': 'Meta API did not return ad id', 'response': data}
    return {
        'ok': True,
        'id': str(ad_id),
        'platform_ad_id': str(ad_id),
        'adset_id': str(adset_id),
        'creative_id': str(creative_id),
    }


def update_ad(
    access_token: str,
    *,
    ad_id: str,
    name: Optional[str] = None,
    status: Optional[str] = None,
    bid_amount: Optional[int] = None,
    tracking_specs: Optional[List[Dict[str, Any]]] = None,
    creative_id: Optional[str] = None,
    api_version: str = 'v22.0',
) -> Dict[str, Any]:
    """POST ad update — reference ``update_ad``."""
    if not ad_id:
        return {'ok': False, 'error': 'ad_id is required'}

    params: Dict[str, Any] = {}
    if name is not None:
        params['name'] = name
    if status is not None:
        params['status'] = status
    if bid_amount is not None:
        params['bid_amount'] = str(bid_amount)
    if tracking_specs is not None:
        params['tracking_specs'] = tracking_specs
    if creative_id is not None:
        params['creative'] = json.dumps({'creative_id': str(creative_id)})

    if not params:
        return {'ok': False, 'error': 'No update parameters provided'}

    data = graph_request(_safe_graph_id(ad_id), access_token, params=params, method='POST', api_version=api_version)
    if data.get('ok') is False:
        return data
    if 'error' in data:
        err = data['error']
        sub = err.get('error_subcode') if isinstance(err, dict) else None
        if creative_id is not None and sub == 3858355:
            return {
                'ok': False,
                'error': 'Cannot swap creative on this ad due to FLEX image mismatch (subcode 3858355)',
                'error_subcode': 3858355,
                'workaround': 'Create a new ad with create_ad, then pause this ad with update_ad status=PAUSED',
            }
        return {'ok': False, 'error': format_graph_error(err), 'error_data': err}
    return {'ok': True, **data} if isinstance(data, dict) else {'ok': True}
