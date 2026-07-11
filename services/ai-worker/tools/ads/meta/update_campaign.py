"""Tool: update Meta campaign (reference update_campaign)."""

from __future__ import annotations

from typing import Any, Dict, Optional, Union

from connectors.meta_ads import update_campaign as connector_update_campaign
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')

    campaign_id = payload.get('campaign_id') or payload.get('platform_campaign_id')
    if not campaign_id:
        raise ToolValidationError('campaign_id is required')

    special = payload.get('special_ad_categories')
    if special is not None and not isinstance(special, list):
        raise ToolValidationError('special_ad_categories must be a list when provided')

    out = connector_update_campaign(
        token,
        campaign_id=str(campaign_id),
        name=payload.get('name'),
        status=payload.get('status'),
        special_ad_categories=special,
        daily_budget=_optional_budget(payload.get('daily_budget')),
        lifetime_budget=_optional_budget(payload.get('lifetime_budget')),
        bid_strategy=payload.get('bid_strategy'),
        bid_cap=payload.get('bid_cap'),
        spend_cap=payload.get('spend_cap'),
        campaign_budget_optimization=payload.get('campaign_budget_optimization'),
        objective=payload.get('objective'),
        use_adset_level_budgets=payload.get('use_adset_level_budgets'),
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'Meta update campaign failed')
    return out


def _optional_budget(v: Any) -> Optional[Union[int, str]]:
    if v is None:
        return None
    if v == '':
        return ''
    return v
