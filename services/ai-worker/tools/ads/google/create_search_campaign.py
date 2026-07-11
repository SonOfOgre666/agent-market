"""Tool: create Google Search campaign (reference create_search_campaign)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.google_ads import create_search_campaign as connector_create_search_campaign
from tools.ads._errors import ToolValidationError
from tools.ads.google._config import require_google_config


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, customer_id = require_google_config(payload)
    name = (payload.get('name') or '').strip()
    if not name:
        raise ToolValidationError('name is required')
    budget_rn = (
        payload.get('budget_resource_name')
        or payload.get('campaign_budget_resource_name')
        or ''
    ).strip()
    if not budget_rn:
        raise ToolValidationError('budget_resource_name is required')

    out = connector_create_search_campaign(
        gcfg,
        customer_id=customer_id,
        name=name,
        budget_resource_name=budget_rn,
        status=str(payload.get('status') or 'PAUSED'),
        target_google_search=bool(payload.get('target_google_search', True)),
        target_search_network=bool(payload.get('target_search_network', False)),
        target_content_network=bool(payload.get('target_content_network', False)),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'create search campaign failed')
    return out
