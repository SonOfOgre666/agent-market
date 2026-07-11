"""Tool: create Google Ads campaign budget (reference create_campaign_budget)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.google_ads import create_campaign_budget
from tools.ads._errors import ToolValidationError
from tools.ads.google._config import require_google_config


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, customer_id = require_google_config(payload)
    name = (payload.get('name') or '').strip()
    if not name:
        raise ToolValidationError('name is required')
    amount_micros = int(payload.get('amount_micros') or 0)
    if amount_micros <= 0:
        daily = payload.get('daily_budget') or payload.get('amount')
        if daily is not None:
            amount_micros = int(round(float(daily) * 1_000_000))
    if amount_micros <= 0:
        raise ToolValidationError('amount_micros or daily_budget is required')

    out = create_campaign_budget(
        gcfg,
        customer_id=customer_id,
        name=name,
        amount_micros=amount_micros,
        delivery_method=str(payload.get('delivery_method') or 'STANDARD'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'create budget failed')
    return out
