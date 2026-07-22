"""Tool: reference create_campaign — budget + campaign (all channel types)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.google_ads.campaigns import create_campaign_with_budget as connector_create
from tools.ads._errors import ToolValidationError
from tools.ads.google._config import require_google_config


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    from tools.ads._budget_currency import convert_payload_budget

    body, conversion = convert_payload_budget(payload, platform='google')
    gcfg, customer_id = require_google_config(body)
    name = (body.get('name') or '').strip()
    if not name:
        raise ToolValidationError('name is required')
    amount = body.get('budget_amount') or body.get('daily_budget')
    if amount is None:
        budget = body.get('budget') or {}
        amount = budget.get('amount')
    if amount is None:
        raise ToolValidationError('budget_amount is required')

    ctype = body.get('campaign_type') or body.get('type') or body.get('channel') or 'SEARCH'
    out = connector_create(
        gcfg,
        customer_id=customer_id,
        name=name,
        budget_amount=float(amount),
        campaign_type=str(ctype),
        status=str(body.get('status') or 'PAUSED'),
        start_date=body.get('start_date'),
        end_date=body.get('end_date'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'create campaign failed')
    if conversion:
        out['budget_conversion'] = body.get('budget_conversion')
    return out
