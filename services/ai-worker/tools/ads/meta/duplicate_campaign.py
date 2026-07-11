"""Tool: duplicate Meta campaign (reference duplicate_campaign)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.meta_ads.duplication import duplicate_campaign as connector_duplicate_campaign
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')
    campaign_id = payload.get('campaign_id') or payload.get('platform_campaign_id')
    if not campaign_id:
        raise ToolValidationError('campaign_id is required')
    out = connector_duplicate_campaign(
        token,
        campaign_id=str(campaign_id),
        name_suffix=payload.get('name_suffix', ' - Copy'),
        include_ad_sets=bool(payload.get('include_ad_sets', True)),
        include_ads=bool(payload.get('include_ads', True)),
        include_creatives=bool(payload.get('include_creatives', True)),
        copy_schedule=bool(payload.get('copy_schedule', False)),
        new_daily_budget=payload.get('new_daily_budget'),
        new_start_time=payload.get('new_start_time'),
        new_end_time=payload.get('new_end_time'),
        new_status=str(payload.get('new_status') or 'PAUSED'),
        pb_token=payload.get('pb_token'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'duplicate_campaign failed')
    return out
