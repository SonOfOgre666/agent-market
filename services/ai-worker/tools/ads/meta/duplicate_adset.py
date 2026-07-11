"""Tool: duplicate Meta ad set (reference duplicate_adset)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.meta_ads.duplication import duplicate_adset as connector_duplicate_adset
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')
    adset_id = payload.get('adset_id') or payload.get('platform_ad_set_id')
    if not adset_id:
        raise ToolValidationError('adset_id is required')
    out = connector_duplicate_adset(
        token,
        adset_id=str(adset_id),
        target_campaign_id=payload.get('target_campaign_id'),
        name_suffix=payload.get('name_suffix', ' - Copy'),
        include_ads=bool(payload.get('include_ads', True)),
        include_creatives=bool(payload.get('include_creatives', True)),
        new_daily_budget=payload.get('new_daily_budget'),
        new_targeting=payload.get('new_targeting'),
        new_start_time=payload.get('new_start_time'),
        new_end_time=payload.get('new_end_time'),
        new_status=str(payload.get('new_status') or 'PAUSED'),
        pb_token=payload.get('pb_token'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'duplicate_adset failed')
    return out
