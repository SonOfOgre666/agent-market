"""Tool: get Meta campaign details (reference get_campaign_details)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.meta_ads import get_campaign_details as connector_get_campaign_details
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')

    campaign_id = payload.get('campaign_id') or payload.get('platform_campaign_id') or payload.get('id')
    if not campaign_id:
        raise ToolValidationError('campaign_id is required')

    out = connector_get_campaign_details(
        token,
        campaign_id=str(campaign_id),
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'Meta get campaign failed')
    return {'ok': True, 'campaign': out.get('campaign') or {}}
