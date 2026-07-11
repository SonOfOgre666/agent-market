"""Tool: get Meta pixel details (Graph GET /{pixel_id})."""

from __future__ import annotations

from typing import Any, Dict

from connectors.meta_ads.pixels import get_ad_pixel as connector_get_ad_pixel
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')

    pixel_id = payload.get('pixel_id') or payload.get('id')
    if not pixel_id:
        raise ToolValidationError('pixel_id is required')

    out = connector_get_ad_pixel(
        token,
        pixel_id=str(pixel_id),
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'Meta get ad pixel failed')
    return out
