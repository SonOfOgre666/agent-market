"""Tool: create Google campaign on existing budget (all channel types)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.google_ads.campaigns import create_typed_campaign as connector_create
from tools.ads._errors import ToolValidationError
from tools.ads.google._config import require_google_config


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, customer_id = require_google_config(payload)
    name = (payload.get('name') or '').strip()
    budget_rn = (
        payload.get('budget_resource_name')
        or payload.get('campaign_budget_resource_name')
        or ''
    ).strip()
    if not name:
        raise ToolValidationError('name is required')
    if not budget_rn:
        raise ToolValidationError('budget_resource_name is required')

    ctype = (
        payload.get('campaign_type')
        or payload.get('type')
        or payload.get('channel')
        or 'SEARCH'
    )
    out = connector_create(
        gcfg,
        customer_id=customer_id,
        name=name,
        budget_resource_name=budget_rn,
        campaign_type=str(ctype),
        status=str(payload.get('status') or 'PAUSED'),
        start_date=payload.get('start_date'),
        end_date=payload.get('end_date'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'create typed campaign failed')
    return out
