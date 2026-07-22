"""Tool: update Google campaign budget (reference update_budget)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.google_ads.budgets import update_campaign_budget
from tools.ads._errors import ToolValidationError
from tools.ads.google._config import require_google_config


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    from tools.ads._budget_currency import convert_payload_budget

    body, conversion = convert_payload_budget(payload, platform='google')
    gcfg, customer_id = require_google_config(body)
    budget_id = body.get('budget_id') or body.get('platform_budget_id')
    if not budget_id:
        raise ToolValidationError('budget_id is required')
    amount_micros = body.get('amount_micros')
    if amount_micros is None and body.get('daily_budget') is not None:
        amount_micros = int(round(float(body['daily_budget']) * 1_000_000))
    elif amount_micros is None and isinstance(body.get('budget'), dict) and body['budget'].get('amount') is not None:
        amount_micros = int(round(float(body['budget']['amount']) * 1_000_000))
    out = update_campaign_budget(
        gcfg,
        customer_id=customer_id,
        budget_id=str(budget_id),
        amount_micros=amount_micros,
        name=body.get('name'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'update budget failed')
    if conversion:
        out['budget_conversion'] = body.get('budget_conversion')
    return out
