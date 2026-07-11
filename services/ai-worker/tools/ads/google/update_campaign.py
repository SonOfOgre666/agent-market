"""Tool: update Google Ads campaign status (reference update_campaign_status)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.google_ads import update_campaign_status
from tools.ads._errors import ToolValidationError
from tools.ads.google._config import require_google_config


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, customer_id = require_google_config(payload)
    platform_campaign_id = payload.get('platform_campaign_id') or payload.get('campaign_id')
    if not platform_campaign_id:
        raise ToolValidationError('platform_campaign_id is required')
    status = (payload.get('status') or '').strip()
    if not status:
        raise ToolValidationError('status is required')

    out = update_campaign_status(
        gcfg,
        customer_id=customer_id,
        platform_campaign_id=str(platform_campaign_id),
        status=status,
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'update campaign failed')
    return out
