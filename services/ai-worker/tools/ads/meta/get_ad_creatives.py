"""Tool: list creatives for an ad (reference get_ad_creatives)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.meta_ads import get_ad_creatives as connector_get_ad_creatives
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')

    ad_id = payload.get('ad_id') or payload.get('platform_ad_id')
    if not ad_id:
        raise ToolValidationError('ad_id is required')

    out = connector_get_ad_creatives(
        token,
        ad_id=str(ad_id),
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'Meta get ad creatives failed')
    return {'ok': True, 'data': out.get('data') or []}
