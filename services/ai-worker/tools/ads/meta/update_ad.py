"""Tool: update Meta ad (reference update_ad)."""

from __future__ import annotations

from typing import Any, Dict, Optional

from connectors.meta_ads import update_ad as connector_update_ad
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')

    ad_id = payload.get('ad_id') or payload.get('platform_ad_id')
    if not ad_id:
        raise ToolValidationError('ad_id is required')

    out = connector_update_ad(
        token,
        ad_id=str(ad_id),
        name=payload.get('name'),
        status=payload.get('status'),
        bid_amount=_optional_int(payload.get('bid_amount')),
        tracking_specs=payload.get('tracking_specs'),
        creative_id=payload.get('creative_id') or payload.get('platform_creative_id'),
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'Meta update ad failed')
    return out


def _optional_int(v: Any) -> Optional[int]:
    if v is None or v == '':
        return None
    return int(v)
