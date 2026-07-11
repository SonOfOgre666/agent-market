"""Tool: create callout extensions (reference create_callout_extensions)."""

from __future__ import annotations

from typing import Any, Dict, List

from connectors.google_ads.extensions import create_callout_extensions
from tools.ads._errors import ToolValidationError
from tools.ads.google._config import require_google_config


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, customer_id = require_google_config(payload)
    camp = payload.get('platform_campaign_id') or payload.get('campaign_id')
    callouts: List[str] = list(payload.get('callouts') or [])
    if not camp or not callouts:
        raise ToolValidationError('platform_campaign_id and callouts[] are required')
    out = create_callout_extensions(
        gcfg, customer_id=customer_id, campaign_id=str(camp), callouts=callouts,
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'callout extensions failed')
    return out
