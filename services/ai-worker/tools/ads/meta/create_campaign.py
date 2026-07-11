"""Tool: create Meta Ads campaign."""

from __future__ import annotations

from typing import Any, Dict, Optional

from connectors.meta_ads import create_campaign as connector_create_campaign
from tools.ads._errors import ToolValidationError

_OBJECTIVE_ALIASES = {
    'traffic': 'OUTCOME_TRAFFIC',
    'awareness': 'OUTCOME_AWARENESS',
    'engagement': 'OUTCOME_ENGAGEMENT',
    'leads': 'OUTCOME_LEADS',
    'sales': 'OUTCOME_SALES',
    'app_promotion': 'OUTCOME_APP_PROMOTION',
}


def _resolve_objective(raw: Any) -> str:
    s = str(raw or '').strip()
    if not s:
        raise ToolValidationError('objective is required')
    key = s.lower()
    if key in _OBJECTIVE_ALIASES:
        return _OBJECTIVE_ALIASES[key]
    return s.upper()


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')

    account_id = payload.get('ad_account_id') or payload.get('account_id')
    name = (payload.get('name') or '').strip()
    objective = _resolve_objective(payload.get('objective'))

    daily_budget: Optional[int] = None
    lifetime_budget: Optional[int] = None
    budget = payload.get('budget') or {}
    if isinstance(budget, dict):
        amount = budget.get('amount')
        if amount is not None:
            cents = int(round(float(amount) * 100))
            if (budget.get('type') or 'daily') == 'lifetime':
                lifetime_budget = cents
            else:
                daily_budget = cents
    if payload.get('daily_budget_cents') is not None:
        daily_budget = int(payload['daily_budget_cents'])
    if payload.get('lifetime_budget_cents') is not None:
        lifetime_budget = int(payload['lifetime_budget_cents'])

    use_abo = bool(payload.get('use_adset_level_budgets'))

    out = connector_create_campaign(
        token,
        account_id=str(account_id or ''),
        name=name,
        objective=objective,
        status=str(payload.get('status') or 'PAUSED'),
        special_ad_categories=payload.get('special_ad_categories'),
        daily_budget=daily_budget,
        lifetime_budget=lifetime_budget,
        buying_type=payload.get('buying_type'),
        bid_strategy=str(payload.get('bid_strategy') or 'LOWEST_COST_WITHOUT_CAP'),
        bid_cap=payload.get('bid_cap'),
        spend_cap=payload.get('spend_cap'),
        campaign_budget_optimization=payload.get('campaign_budget_optimization'),
        ab_test_control_setups=payload.get('ab_test_control_setups'),
        use_adset_level_budgets=use_abo,
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'Meta create campaign failed')
    return out
