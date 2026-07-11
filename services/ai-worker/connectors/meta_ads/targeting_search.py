"""Meta Ads targeting search APIs — reference_ads/meta_ads/targeting.py (no MCP)."""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional, Union

from .api import format_graph_error, graph_request
from .utils import ensure_act_prefix


def _ok_data(data: Dict[str, Any]) -> Dict[str, Any]:
    if data.get('ok') is False:
        return data
    if 'error' in data:
        err = data['error']
        return {'ok': False, 'error': format_graph_error(err) if isinstance(err, dict) else str(err), 'raw': data}
    return {'ok': True, **data}


def search_interests(
    access_token: str,
    *,
    query: str,
    limit: int = 25,
    api_version: str = 'v22.0',
) -> Dict[str, Any]:
    if not query:
        return {'ok': False, 'error': 'query is required'}
    data = graph_request(
        'search',
        access_token,
        params={'type': 'adinterest', 'q': query, 'limit': limit},
        api_version=api_version,
    )
    return _ok_data(data)


def get_interest_suggestions(
    access_token: str,
    *,
    interest_list: List[str],
    limit: int = 25,
    api_version: str = 'v22.0',
) -> Dict[str, Any]:
    if not interest_list:
        return {'ok': False, 'error': 'interest_list is required'}
    data = graph_request(
        'search',
        access_token,
        params={'type': 'adinterestsuggestion', 'interest_list': json.dumps(interest_list), 'limit': limit},
        api_version=api_version,
    )
    return _ok_data(data)


def _has_location_or_custom_audience(targeting: Dict[str, Any]) -> bool:
    geo = targeting.get('geo_locations') or {}
    if isinstance(geo, dict):
        for key in ('countries', 'regions', 'cities', 'zips', 'geo_markets', 'country_groups'):
            val = geo.get(key)
            if isinstance(val, list) and val:
                return True
    ca = targeting.get('custom_audiences')
    if isinstance(ca, list) and ca:
        return True
    flex = targeting.get('flexible_spec')
    if isinstance(flex, list):
        for spec in flex:
            if isinstance(spec, dict) and spec.get('custom_audiences'):
                return True
    return False


def estimate_audience_size(
    access_token: str,
    *,
    account_id: Optional[str] = None,
    targeting: Optional[Dict[str, Any]] = None,
    optimization_goal: str = 'REACH',
    interest_list: Optional[List[str]] = None,
    interest_fbid_list: Optional[List[str]] = None,
    api_version: str = 'v22.0',
) -> Dict[str, Any]:
    """Reference ``estimate_audience_size`` — reachestimate or adinterestvalid fallback."""
    is_legacy = (interest_list or interest_fbid_list) or (not account_id and not targeting)
    if is_legacy and not targeting:
        if not interest_list and not interest_fbid_list:
            return {'ok': False, 'error': 'interest_list or interest_fbid_list required for legacy mode'}
        params: Dict[str, Any] = {'type': 'adinterestvalid'}
        if interest_list:
            params['interest_list'] = json.dumps(interest_list)
        if interest_fbid_list:
            params['interest_fbid_list'] = json.dumps(interest_fbid_list)
        return _ok_data(graph_request('search', access_token, params=params, api_version=api_version))

    if not account_id:
        return {'ok': False, 'error': 'account_id is required for comprehensive audience estimation'}
    if not targeting:
        return {'ok': False, 'error': 'targeting is required for comprehensive audience estimation'}

    if not _has_location_or_custom_audience(targeting):
        return {
            'ok': False,
            'error': 'Missing target audience location',
            'details': 'Add geo_locations or custom_audiences in targeting',
        }

    act = ensure_act_prefix(str(account_id))
    data = graph_request(f'{act}/reachestimate', access_token, params={'targeting_spec': targeting}, api_version=api_version)

    if isinstance(data, dict) and 'error' in data:
        disable_fallback = os.environ.get('META_MCP_DISABLE_DELIVERY_FALLBACK', '1') == '1'
        if not disable_fallback:
            fb = graph_request(
                f'{act}/delivery_estimate',
                access_token,
                params={'targeting_spec': json.dumps(targeting), 'optimization_goal': optimization_goal},
                api_version=api_version,
            )
            if isinstance(fb, dict) and fb.get('data'):
                row = fb['data'][0] if fb['data'] else {}
                return {
                    'ok': True,
                    'account_id': act,
                    'targeting': targeting,
                    'optimization_goal': optimization_goal,
                    'estimated_audience_size': row.get('estimate_mau', 0),
                    'estimate_details': row,
                    'fallback_endpoint_used': 'delivery_estimate',
                }
        return _ok_data(data)

    if isinstance(data, dict) and 'data' in data:
        rd = data['data']
        if isinstance(rd, list) and rd:
            row = rd[0]
            return {
                'ok': True,
                'account_id': act,
                'targeting': targeting,
                'optimization_goal': optimization_goal,
                'estimated_audience_size': row.get('estimate_mau', 0),
                'estimate_details': row,
                'raw_response': data,
            }
        if isinstance(rd, dict):
            lower = rd.get('users_lower_bound')
            upper = rd.get('users_upper_bound')
            midpoint = int((lower + upper) / 2) if isinstance(lower, (int, float)) and isinstance(upper, (int, float)) else 0
            return {
                'ok': True,
                'account_id': act,
                'targeting': targeting,
                'optimization_goal': optimization_goal,
                'estimated_audience_size': midpoint,
                'estimate_details': rd,
                'raw_response': data,
            }

    return {'ok': False, 'error': 'No estimation data returned', 'raw_response': data}


def search_behaviors(
    access_token: str,
    *,
    limit: int = 50,
    api_version: str = 'v22.0',
) -> Dict[str, Any]:
    return _ok_data(
        graph_request(
            'search',
            access_token,
            params={'type': 'adTargetingCategory', 'class': 'behaviors', 'limit': limit},
            api_version=api_version,
        )
    )


def search_demographics(
    access_token: str,
    *,
    demographic_class: str = 'demographics',
    limit: int = 50,
    api_version: str = 'v22.0',
) -> Dict[str, Any]:
    return _ok_data(
        graph_request(
            'search',
            access_token,
            params={'type': 'adTargetingCategory', 'class': demographic_class, 'limit': limit},
            api_version=api_version,
        )
    )


def search_geo_locations(
    access_token: str,
    *,
    query: str,
    location_types: Optional[List[str]] = None,
    limit: int = 25,
    api_version: str = 'v22.0',
) -> Dict[str, Any]:
    if not query:
        return {'ok': False, 'error': 'query is required'}
    params: Dict[str, Any] = {'type': 'adgeolocation', 'q': query, 'limit': limit}
    if location_types:
        params['location_types'] = json.dumps(location_types)
    return _ok_data(graph_request('search', access_token, params=params, api_version=api_version))
