"""Tool: create Google Ads campaign budget (reference create_campaign_budget)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.google_ads import create_campaign_budget
from tools.ads._errors import ToolValidationError
from tools.ads.google._config import require_google_config


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    from tools.ads._budget_currency import convert_payload_budget

    body, conversion = convert_payload_budget(payload, platform='google')
    gcfg, customer_id = require_google_config(body)
    name = (body.get('name') or '').strip()
    if not name:
        raise ToolValidationError('name is required')
    amount_micros = int(body.get('amount_micros') or 0)
    if amount_micros <= 0:
        daily = body.get('daily_budget') or body.get('amount')
        if daily is None and isinstance(body.get('budget'), dict):
            daily = body['budget'].get('amount')
        if daily is not None:
            amount_micros = int(round(float(daily) * 1_000_000))
    if amount_micros <= 0:
        raise ToolValidationError('amount_micros or daily_budget is required')

    out = create_campaign_budget(
        gcfg,
        customer_id=customer_id,
        name=name,
        amount_micros=amount_micros,
        delivery_method=str(body.get('delivery_method') or 'STANDARD'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'create budget failed')
    if conversion:
        out['budget_conversion'] = body.get('budget_conversion')
        out['amount'] = conversion.amount
        out['currency'] = conversion.account_currency
    return out
