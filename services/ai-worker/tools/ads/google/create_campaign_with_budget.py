"""Tool: reference create_campaign — budget + campaign (all channel types)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.google_ads.campaigns import create_campaign_with_budget as connector_create
from tools.ads._errors import ToolValidationError
from tools.ads.google._config import require_google_config


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, customer_id = require_google_config(payload)
    name = (payload.get('name') or '').strip()
    if not name:
        raise ToolValidationError('name is required')
    amount = payload.get('budget_amount') or payload.get('daily_budget')
    if amount is None:
        budget = payload.get('budget') or {}
        amount = budget.get('amount')
    if amount is None:
        raise ToolValidationError('budget_amount is required')

    ctype = payload.get('campaign_type') or payload.get('type') or payload.get('channel') or 'SEARCH'
    out = connector_create(
        gcfg,
        customer_id=customer_id,
        name=name,
        budget_amount=float(amount),
        campaign_type=str(ctype),
        status=str(payload.get('status') or 'PAUSED'),
        start_date=payload.get('start_date'),
        end_date=payload.get('end_date'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'create campaign failed')
    return out
