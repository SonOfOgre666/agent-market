"""Meta campaign budget schedules — reference_ads/meta_ads/budget_schedules.py (no MCP)."""

from __future__ import annotations

from typing import Any, Dict, Optional

from .api import format_graph_error, graph_request


def create_budget_schedule(
    access_token: str,
    *,
    campaign_id: str,
    budget_value: int,
    budget_value_type: str,
    time_start: int,
    time_end: int,
    api_version: str = 'v22.0',
) -> Dict[str, Any]:
    if not campaign_id:
        return {'ok': False, 'error': 'campaign_id is required'}
    if budget_value is None:
        return {'ok': False, 'error': 'budget_value is required'}
    if not budget_value_type:
        return {'ok': False, 'error': 'budget_value_type is required'}
    if budget_value_type not in ('ABSOLUTE', 'MULTIPLIER'):
        return {'ok': False, 'error': 'budget_value_type must be ABSOLUTE or MULTIPLIER'}
    if time_start is None or time_end is None:
        return {'ok': False, 'error': 'time_start and time_end are required'}

    params = {
        'budget_value': budget_value,
        'budget_value_type': budget_value_type,
        'time_start': time_start,
        'time_end': time_end,
    }
    data = graph_request(
        f'{campaign_id}/budget_schedules',
        access_token,
        params=params,
        method='POST',
        api_version=api_version,
    )
    if data.get('ok') is False:
        return data
    if 'error' in data:
        err = data['error']
        return {
            'ok': False,
            'error': format_graph_error(err) if isinstance(err, dict) else str(err),
            'campaign_id': campaign_id,
            'params_sent': params,
        }
    return {'ok': True, **data}
