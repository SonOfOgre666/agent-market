"""Tool: update Google campaign budget (reference update_budget)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.google_ads.budgets import update_campaign_budget
from tools.ads._errors import ToolValidationError
from tools.ads.google._config import require_google_config


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, customer_id = require_google_config(payload)
    budget_id = payload.get('budget_id') or payload.get('platform_budget_id')
    if not budget_id:
        raise ToolValidationError('budget_id is required')
    amount_micros = payload.get('amount_micros')
    if amount_micros is None and payload.get('daily_budget') is not None:
        amount_micros = int(round(float(payload['daily_budget']) * 1_000_000))
    out = update_campaign_budget(
        gcfg,
        customer_id=customer_id,
        budget_id=str(budget_id),
        amount_micros=amount_micros,
        name=payload.get('name'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'update budget failed')
    return out
