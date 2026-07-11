"""Tool: get one Google Ads campaign (meta_get_campaign parity)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.google_ads.campaigns import get_campaign as connector_get_campaign
from tools.ads._errors import ToolValidationError
from tools.ads.google._config import require_google_config


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, customer_id = require_google_config(payload)
    campaign_id = (
        payload.get('platform_campaign_id')
        or payload.get('google_campaign_id')
        or payload.get('campaign_id')
    )
    if not campaign_id:
        raise ToolValidationError('platform_campaign_id or campaign_id is required')
    out = connector_get_campaign(gcfg, customer_id=customer_id, campaign_id=str(campaign_id))
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'get campaign failed')
    return out
