"""Tool: create Meta campaign budget schedule (reference create_budget_schedule)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.meta_ads.budget_schedules import create_budget_schedule as connector_create_budget_schedule
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')
    campaign_id = payload.get('campaign_id') or payload.get('platform_campaign_id')
    if not campaign_id:
        raise ToolValidationError('campaign_id is required')
    out = connector_create_budget_schedule(
        token,
        campaign_id=str(campaign_id),
        budget_value=int(payload['budget_value']),
        budget_value_type=str(payload['budget_value_type']),
        time_start=int(payload['time_start']),
        time_end=int(payload['time_end']),
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'create_budget_schedule failed')
    return out
