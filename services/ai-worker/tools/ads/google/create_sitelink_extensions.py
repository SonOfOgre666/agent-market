"""Tool: create sitelink extensions (reference create_sitelink_extensions)."""

from __future__ import annotations

from typing import Any, Dict, List

from connectors.google_ads.extensions import create_sitelink_extensions
from tools.ads._errors import ToolValidationError
from tools.ads.google._config import require_google_config


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, customer_id = require_google_config(payload)
    camp = payload.get('platform_campaign_id') or payload.get('campaign_id')
    sitelinks: List[Dict[str, str]] = list(payload.get('sitelinks') or [])
    if not camp or not sitelinks:
        raise ToolValidationError('platform_campaign_id and sitelinks[] are required')
    out = create_sitelink_extensions(
        gcfg, customer_id=customer_id, campaign_id=str(camp), sitelinks=sitelinks,
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'sitelink extensions failed')
    return out
