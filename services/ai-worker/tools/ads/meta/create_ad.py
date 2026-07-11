"""Tool: create Meta ad (reference create_ad)."""

from __future__ import annotations

from typing import Any, Dict, Optional

from connectors.meta_ads import create_ad as connector_create_ad
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')

    account_id = payload.get('ad_account_id') or payload.get('account_id')
    adset_id = payload.get('adset_id') or payload.get('platform_ad_set_id')
    creative_id = payload.get('creative_id') or payload.get('platform_creative_id')
    name = (payload.get('name') or 'Ad').strip()

    if not account_id or not adset_id or not creative_id:
        raise ToolValidationError('ad_account_id, adset_id, and creative_id are required')

    out = connector_create_ad(
        token,
        account_id=str(account_id),
        name=name,
        adset_id=str(adset_id),
        creative_id=str(creative_id),
        status=str(payload.get('status') or 'PAUSED'),
        bid_amount=_optional_int(payload.get('bid_amount')),
        tracking_specs=payload.get('tracking_specs'),
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'Meta create ad failed')
    return out


def _optional_int(v: Any) -> Optional[int]:
    if v is None or v == '':
        return None
    return int(v)
