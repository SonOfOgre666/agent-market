"""Meta Ads insights — parity with reference_ads/meta_ads/insights.py (no MCP)."""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional, Union

from .api import format_graph_error, graph_request

_REDUNDANT_ACTION_PREFIXES = (
    'omni_',
    'onsite_web_app_',
    'onsite_web_',
    'onsite_app_',
    'web_app_in_store_',
    'offsite_conversion.fb_pixel_',
)

_BREAKDOWNS_INCOMPATIBLE_WITH_ACTION_TYPE = frozenset({'platform_position'})

_BREAKDOWNS_REQUIRING_EMPTY_ACTION_BREAKDOWNS = frozenset({'media_type'})

_ACTION_TYPED_FIELDS = frozenset({
    'actions',
    'action_values',
    'cost_per_action_type',
    'conversions',
})

_INSIGHT_FIELDS = [
    'account_id',
    'account_name',
    'campaign_id',
    'campaign_name',
    'adset_id',
    'adset_name',
    'ad_id',
    'ad_name',
    'impressions',
    'clicks',
    'spend',
    'cpc',
    'cpm',
    'ctr',
    'reach',
    'frequency',
    'actions',
    'action_values',
    'conversions',
    'unique_clicks',
    'cost_per_action_type',
]


def _safe_graph_id(x: str) -> str:
    s = str(x or '').strip().lstrip('/')
    if not s or not re.match(r'^[a-zA-Z0-9_]+$', s):
        raise ValueError('Invalid id for Graph path')
    return s


def _clamp_limit(n: Any, default: int = 25) -> int:
    try:
        v = int(n)
    except (TypeError, ValueError):
        v = default
    return max(1, min(500, v))


def _strip_redundant_actions(row: dict) -> dict:
    for key in ('actions', 'action_values', 'cost_per_action_type'):
        items = row.get(key)
        if not isinstance(items, list):
            continue
        row[key] = [
            item
            for item in items
            if not any(
                str(item.get('action_type', '')).startswith(prefix)
                for prefix in _REDUNDANT_ACTION_PREFIXES
            )
        ]
    return row


def _resolve_object_id(
    object_id: str = '',
    *,
    account_id: str = '',
    campaign_id: str = '',
    adset_id: str = '',
    ad_id: str = '',
) -> str:
    oid = (object_id or account_id or campaign_id or adset_id or ad_id or '').strip()
    if not oid:
        raise ValueError('object_id is required (or account_id, campaign_id, adset_id, ad_id)')
    return oid


def get_insights(
    access_token: str,
    *,
    object_id: str = '',
    time_range: Union[str, Dict[str, str], None] = 'maximum',
    breakdown: str = '',
    level: str = 'ad',
    limit: int = 25,
    after: str = '',
    action_attribution_windows: Optional[List[str]] = None,
    action_breakdowns: Optional[List[str]] = None,
    compact: bool = False,
    account_id: str = '',
    campaign_id: str = '',
    adset_id: str = '',
    ad_id: str = '',
    api_version: str = 'v22.0',
) -> Dict[str, Any]:
    """
    GET ``/{object_id}/insights`` — reference ``get_insights``.

    Returns ``{ok, data, paging}`` (Graph-shaped rows). Use ``compact=True`` to strip redundant action types.
    """
    oid_raw = _resolve_object_id(
        object_id,
        account_id=account_id,
        campaign_id=campaign_id,
        adset_id=adset_id,
        ad_id=ad_id,
    )
    oid = _safe_graph_id(oid_raw)

    fields = list(_INSIGHT_FIELDS)
    breakdown_values = [b.strip() for b in breakdown.split(',') if b.strip()] if breakdown else []
    breakdown_set = set(breakdown_values)
    if 'platform_position' in breakdown_set and 'publisher_platform' not in breakdown_set:
        breakdown_values = ['publisher_platform', *breakdown_values]
        breakdown_set.add('publisher_platform')
    if breakdown_set & _BREAKDOWNS_INCOMPATIBLE_WITH_ACTION_TYPE:
        fields = [f for f in fields if f not in _ACTION_TYPED_FIELDS]
    override_action_breakdowns_empty = bool(breakdown_set & _BREAKDOWNS_REQUIRING_EMPTY_ACTION_BREAKDOWNS)

    params: Dict[str, Any] = {
        'fields': ','.join(fields),
        'level': level or 'ad',
        'limit': _clamp_limit(limit, default=25),
    }

    if isinstance(time_range, dict):
        if time_range.get('since') and time_range.get('until'):
            params['time_range'] = json.dumps(
                {'since': str(time_range['since']), 'until': str(time_range['until'])},
            )
        else:
            return {
                'ok': False,
                'error': "Custom time_range must contain both 'since' and 'until' in YYYY-MM-DD format",
            }
    else:
        params['date_preset'] = str(time_range or 'maximum')

    if breakdown_values:
        params['breakdowns'] = ','.join(breakdown_values)

    if action_breakdowns is not None:
        params['action_breakdowns'] = (
            '[' + ','.join(action_breakdowns) + ']' if action_breakdowns else '[]'
        )
    elif override_action_breakdowns_empty:
        params['action_breakdowns'] = '[]'

    if after:
        params['after'] = str(after)

    if action_attribution_windows:
        params['action_attribution_windows'] = (
            '[' + ','.join(f"'{w}'" for w in action_attribution_windows) + ']'
        )

    data = graph_request(f'{oid}/insights', access_token, params=params, method='GET', api_version=api_version)
    if data.get('ok') is False:
        return data
    if isinstance(data, dict) and 'error' in data:
        err = data['error']
        return {
            'ok': False,
            'error': format_graph_error(err) if isinstance(err, dict) else str(err),
            'error_data': err,
        }

    rows = list(data.get('data') or []) if isinstance(data, dict) else []
    if compact:
        for row in rows:
            if isinstance(row, dict):
                _strip_redundant_actions(row)

    return {
        'ok': True,
        'data': rows,
        'paging': data.get('paging') if isinstance(data, dict) else None,
        'object_id': oid,
    }
