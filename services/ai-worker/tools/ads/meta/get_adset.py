"""Tool: get Meta ad set details (reference get_adset_details)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.meta_ads import get_adset_details as connector_get_adset_details
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')

    adset_id = payload.get('adset_id') or payload.get('ad_set_id') or payload.get('platform_ad_set_id')
    if not adset_id:
        raise ToolValidationError('adset_id is required')

    out = connector_get_adset_details(
        token,
        adset_id=str(adset_id),
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'Meta get ad set failed')
    return {'ok': True, 'adset': out.get('adset') or {}}
