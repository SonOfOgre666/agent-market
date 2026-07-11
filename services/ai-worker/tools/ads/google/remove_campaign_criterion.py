"""Tool: remove a Google campaign criterion (reference remove_campaign_criterion)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.google_ads import remove_campaign_criterion
from tools.ads._errors import ToolValidationError
from tools.ads.google._config import require_google_config


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, customer_id = require_google_config(payload)
    campaign_id = payload.get('campaign_id') or payload.get('platform_campaign_id')
    criterion_id = payload.get('criterion_id')
    if not campaign_id:
        raise ToolValidationError('campaign_id is required')
    if not criterion_id:
        raise ToolValidationError('criterion_id is required')

    out = remove_campaign_criterion(
        gcfg,
        customer_id=customer_id,
        campaign_id=str(campaign_id),
        criterion_id=str(criterion_id),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'remove campaign criterion failed')
    return out
