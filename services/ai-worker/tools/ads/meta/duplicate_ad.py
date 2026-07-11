"""Tool: duplicate Meta ad (reference duplicate_ad)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.meta_ads.duplication import duplicate_ad as connector_duplicate_ad
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')
    ad_id = payload.get('ad_id') or payload.get('platform_ad_id')
    if not ad_id:
        raise ToolValidationError('ad_id is required')
    out = connector_duplicate_ad(
        token,
        ad_id=str(ad_id),
        target_adset_id=payload.get('target_adset_id'),
        name_suffix=payload.get('name_suffix', ' - Copy'),
        duplicate_creative=bool(payload.get('duplicate_creative', True)),
        new_creative_name=payload.get('new_creative_name'),
        new_status=str(payload.get('new_status') or 'PAUSED'),
        pb_token=payload.get('pb_token'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'duplicate_ad failed')
    return out
