"""Tool: create Meta pixel on ad account (Graph POST /{act}/adspixels)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.meta_ads.pixels import create_ad_pixel as connector_create_ad_pixel
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')

    ad_account_id = payload.get('ad_account_id') or payload.get('account_id')
    if not ad_account_id:
        raise ToolValidationError('ad_account_id is required (Graph act_ id)')

    name = str(payload.get('name') or '').strip()
    if not name:
        raise ToolValidationError('name is required')

    out = connector_create_ad_pixel(
        token,
        account_id=str(ad_account_id),
        name=name,
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'Meta create ad pixel failed')
    return out
