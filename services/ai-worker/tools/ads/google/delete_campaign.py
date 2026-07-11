"""Tool: delete Google campaign (reference delete_campaign)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.google_ads.campaigns import delete_campaign as connector_delete
from tools.ads._errors import ToolValidationError
from tools.ads.google._config import require_google_config


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, customer_id = require_google_config(payload)
    cid = payload.get('platform_campaign_id') or payload.get('campaign_id')
    if not cid:
        raise ToolValidationError('platform_campaign_id is required')
    out = connector_delete(gcfg, customer_id=customer_id, campaign_id=str(cid))
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'delete campaign failed')
    return out
