"""Tool: copy Google campaign (reference copy_campaign)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.google_ads.campaigns import copy_campaign as connector_copy
from tools.ads._errors import ToolValidationError
from tools.ads.google._config import require_google_config


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, customer_id = require_google_config(payload)
    src = payload.get('source_campaign_id') or payload.get('platform_campaign_id')
    name = (payload.get('new_name') or payload.get('name') or '').strip()
    if not src or not name:
        raise ToolValidationError('source_campaign_id and new_name are required')
    out = connector_copy(
        gcfg,
        customer_id=customer_id,
        source_campaign_id=str(src),
        new_name=name,
        budget_amount=payload.get('budget_amount'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'copy campaign failed')
    return out
