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
    from tools.ads._budget_currency import convert_payload_budget

    body, conversion = convert_payload_budget(payload, platform='meta')
    token = (body.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')

    account_id = body.get('ad_account_id') or body.get('account_id')
    name = (body.get('name') or '').strip()
    objective = _resolve_objective(body.get('objective'))

    daily_budget: Optional[int] = None
    lifetime_budget: Optional[int] = None
    budget = body.get('budget') or {}
    if isinstance(budget, dict):
        amount = budget.get('amount')
        if amount is not None:
            cents = int(round(float(amount) * 100))
            if (budget.get('type') or 'daily') == 'lifetime':
                lifetime_budget = cents
            else:
                daily_budget = cents
    if body.get('daily_budget_cents') is not None:
        daily_budget = int(body['daily_budget_cents'])
    if body.get('lifetime_budget_cents') is not None:
        lifetime_budget = int(body['lifetime_budget_cents'])

    use_abo = bool(body.get('use_adset_level_budgets'))

    out = connector_create_campaign(
        token,
        account_id=str(account_id or ''),
        name=name,
        objective=objective,
        status=str(body.get('status') or 'PAUSED'),
        special_ad_categories=body.get('special_ad_categories'),
        daily_budget=daily_budget,
        lifetime_budget=lifetime_budget,
        buying_type=body.get('buying_type'),
        bid_strategy=str(body.get('bid_strategy') or 'LOWEST_COST_WITHOUT_CAP'),
        bid_cap=body.get('bid_cap'),
        spend_cap=body.get('spend_cap'),
        campaign_budget_optimization=body.get('campaign_budget_optimization'),
        ab_test_control_setups=body.get('ab_test_control_setups'),
        use_adset_level_budgets=use_abo,
        api_version=str(body.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'Meta create campaign failed')
    if conversion:
        out['budget_conversion'] = body.get('budget_conversion')
    return out
