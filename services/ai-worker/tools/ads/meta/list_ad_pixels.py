"""Tool: list Meta pixels on an ad account (Graph GET /{act}/adspixels)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.meta_ads.pixels import list_ad_pixels as connector_list_ad_pixels
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')

    ad_account_id = payload.get('ad_account_id') or payload.get('account_id')
    if not ad_account_id:
        raise ToolValidationError('ad_account_id is required (Graph act_ id)')

    out = connector_list_ad_pixels(
        token,
        account_id=str(ad_account_id),
        limit=int(payload.get('limit') or 50),
        after=str(payload.get('after') or ''),
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'Meta list ad pixels failed')
    return out
