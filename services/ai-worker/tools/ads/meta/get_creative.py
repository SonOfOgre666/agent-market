"""Tool: get Meta creative details (reference get_creative_details)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.meta_ads import get_creative_details as connector_get_creative_details
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')

    creative_id = payload.get('creative_id') or payload.get('platform_creative_id')
    if not creative_id:
        raise ToolValidationError('creative_id is required')

    out = connector_get_creative_details(
        token,
        creative_id=str(creative_id),
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'Meta get creative failed')
    return {'ok': True, 'creative': out.get('creative') or {}}
