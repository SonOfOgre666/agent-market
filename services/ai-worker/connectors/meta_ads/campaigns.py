"""Meta Ads campaign reads and mutations — parity with reference_ads/meta_ads/campaigns.py (no MCP)."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Union

from .api import GraphAPIError, format_graph_error, graph_request
from .utils import ensure_act_prefix, map_campaign_status, normalize_act_id

logger = logging.getLogger(__name__)

VALID_OBJECTIVES = frozenset({
    'OUTCOME_AWARENESS',
    'OUTCOME_TRAFFIC',
    'OUTCOME_ENGAGEMENT',
    'OUTCOME_LEADS',
    'OUTCOME_SALES',
    'OUTCOME_APP_PROMOTION',
})

# Same defaults as reference_ads/meta_ads/campaigns.py
DEFAULT_CBO_BUDGET_CENTS = 1000

CAMPAIGN_LIST_FIELDS = (
    'id,name,objective,status,daily_budget,lifetime_budget,buying_type,start_time,stop_time,'
    'created_time,updated_time,bid_strategy,special_ad_categories'
)

CAMPAIGN_DETAIL_FIELDS = (
    'id,name,objective,status,daily_budget,lifetime_budget,buying_type,start_time,stop_time,'
    'created_time,updated_time,bid_strategy,special_ad_categories,special_ad_category_country,'
    'budget_remaining,configured_status'
)


def _graph_or_error(
    endpoint: str,
    access_token: str,
    *,
    params: Optional[Dict[str, Any]] = None,
    method: str = 'GET',
    api_version: str = 'v22.0',
    timeout: float = 120.0,
) -> Dict[str, Any]:
    try:
        return graph_request(
            endpoint,
            access_token,
            params=params,
            method=method,
            api_version=api_version,
            timeout=timeout,
        )
    except GraphAPIError as exc:
        err = exc.error_data if isinstance(exc.error_data, dict) else {'message': str(exc)}
        return {'ok': False, 'error': format_graph_error(err), 'error_data': err}


def list_campaigns(
    access_token: str,
    *,
    account_id: str,
    limit: int = 50,
    status_filter: str = '',
    objective_filter: Union[str, Sequence[str]] = '',
    after: str = '',
    api_version: str = 'v22.0',
    timeout: float = 120.0,
) -> Dict[str, Any]:
    """
    Graph GET ``/{act_}/campaigns`` with optional effective_status + objective filtering.
    Same contract as reference ``get_campaigns`` (returns ``data`` + ``paging``).
    """
    if not account_id:
        return {'ok': False, 'error': 'account_id is required', 'data': [], 'paging': None}
    act_id = ensure_act_prefix(account_id)
    params: Dict[str, Any] = {
        'fields': CAMPAIGN_LIST_FIELDS,
        'limit': str(limit),
    }
    if status_filter:
        params['effective_status'] = json.dumps([status_filter])
    filters: List[Dict[str, Any]] = []
    if objective_filter:
        objectives = [objective_filter] if isinstance(objective_filter, str) else list(objective_filter)
        objectives = [str(o) for o in objectives if o]
        if objectives:
            filters.append({'field': 'objective', 'operator': 'IN', 'value': objectives})
    if filters:
        params['filtering'] = json.dumps(filters)
    if after:
        params['after'] = after

    data = _graph_or_error(f'{act_id}/campaigns', access_token, params=params, method='GET', api_version=api_version, timeout=timeout)
    if data.get('ok') is False:
        return {**data, 'data': [], 'paging': None}
    if 'error' in data:
        err = data['error']
        return {
            'ok': False,
            'error': format_graph_error(err) if isinstance(err, dict) else str(err),
            'data': [],
            'paging': None,
        }
    return {'ok': True, 'data': data.get('data') or [], 'paging': data.get('paging')}


def get_campaign_details(
    access_token: str,
    *,
    campaign_id: str,
    api_version: str = 'v22.0',
    timeout: float = 120.0,
) -> Dict[str, Any]:
    """Graph GET ``/{campaign_id}`` — same fields as reference ``get_campaign_details``."""
    if not campaign_id:
        return {'ok': False, 'error': 'campaign_id is required'}
    cid = str(campaign_id).strip().lstrip('/')
    data = _graph_or_error(
        cid,
        access_token,
        params={'fields': CAMPAIGN_DETAIL_FIELDS},
        method='GET',
        api_version=api_version,
        timeout=timeout,
    )
    if data.get('ok') is False:
        return data
    if 'error' in data:
        err = data['error']
        return {'ok': False, 'error': format_graph_error(err) if isinstance(err, dict) else str(err)}
    return {'ok': True, 'campaign': data}


def _purchase_value_from_insights(row: Dict[str, Any]) -> float:
    total = 0.0
    for item in row.get('action_values') or []:
        action_type = str(item.get('action_type') or '').lower()
        if 'purchase' in action_type or 'omni_purchase' in action_type:
            total += float(item.get('value') or 0)
    return total


def _conversions_from_insights(row: Dict[str, Any]) -> float:
    total = 0.0
    for item in row.get('actions') or []:
        action_type = str(item.get('action_type') or '').lower()
        if any(k in action_type for k in ('purchase', 'lead', 'complete_registration', 'offsite_conversion')):
            total += float(item.get('value') or 0)
    return total


def _metrics_from_insights_row(row: Dict[str, Any]) -> Dict[str, Any]:
    spend = float(row.get('spend') or 0)
    clicks = int(float(row.get('clicks') or 0))
    impressions = int(float(row.get('impressions') or 0))
    conversions = _conversions_from_insights(row)
    conversion_value = _purchase_value_from_insights(row)
    return {
        'impressions': impressions,
        'clicks': clicks,
        'spend': round(spend, 2),
        'conversions': conversions,
        'conversion_value': round(conversion_value, 2),
        'ctr': float(row.get('ctr') or 0),
        'cpc': float(row.get('cpc') or 0) if row.get('cpc') else (round(spend / clicks, 4) if clicks else 0),
    }


def _row_for_workspace_sync(c: Dict[str, Any], metrics_by_campaign: Optional[Dict[str, Dict[str, Any]]] = None) -> Dict[str, Any]:
    daily = c.get('daily_budget')
    life = c.get('lifetime_budget')
    budget = None
    if daily:
        budget = float(daily) / 100.0
    elif life:
        budget = float(life) / 100.0
    st = c.get('start_time')
    sp = c.get('stop_time')
    cid = str(c.get('id') or '')
    metrics = (metrics_by_campaign or {}).get(cid) or {}
    return {
        'meta_campaign_id': cid,
        'name': c.get('name') or '',
        'status': map_campaign_status(c.get('status')),
        'objective': c.get('objective'),
        'budget': budget,
        'start_date': datetime.fromtimestamp(int(st), tz=timezone.utc).isoformat() if st else None,
        'end_date': datetime.fromtimestamp(int(sp), tz=timezone.utc).isoformat() if sp else None,
        'metrics': metrics,
    }


def fetch_campaigns_for_ad_account(
    access_token: str,
    *,
    ad_account_id: Optional[str] = None,
    provider_id: Optional[str] = None,
    api_version: str = 'v22.0',
    timeout: float = 120.0,
) -> List[Dict[str, Any]]:
    """
    Normalized rows for workspace sync — **one** implementation: delegates to ``list_campaigns``.
    """
    act_id = normalize_act_id(ad_account_id, provider_id)
    if not act_id or not access_token:
        return []
    res = list_campaigns(
        access_token,
        account_id=act_id,
        limit=500,
        api_version=api_version,
        timeout=timeout,
    )
    if not res.get('ok'):
        logger.warning('[connector.meta_ads] list_campaigns failed: %s', res.get('error'))
        return []

    metrics_by_campaign: Dict[str, Dict[str, Any]] = {}
    try:
        from .insights import get_insights
        ins = get_insights(
            access_token,
            account_id=act_id,
            level='campaign',
            time_range='last_30d',
            limit=500,
            api_version=api_version,
            timeout=timeout,
        )
        if ins.get('ok'):
            for row in ins.get('data') or []:
                cid = str(row.get('campaign_id') or '')
                if cid:
                    metrics_by_campaign[cid] = _metrics_from_insights_row(row)
    except Exception as exc:
        logger.warning('[connector.meta_ads] campaign insights skipped: %s', exc)

    return [_row_for_workspace_sync(c, metrics_by_campaign) for c in (res.get('data') or [])]


def create_campaign(
    access_token: str,
    *,
    account_id: str,
    name: str,
    objective: str,
    status: str = 'PAUSED',
    special_ad_categories: Optional[List[str]] = None,
    daily_budget: Optional[Union[int, str]] = None,
    lifetime_budget: Optional[Union[int, str]] = None,
    buying_type: Optional[str] = None,
    bid_strategy: str = 'LOWEST_COST_WITHOUT_CAP',
    bid_cap: Optional[Union[int, str]] = None,
    spend_cap: Optional[Union[int, str]] = None,
    campaign_budget_optimization: Optional[bool] = None,
    ab_test_control_setups: Optional[List[Dict[str, Any]]] = None,
    use_adset_level_budgets: bool = False,
    api_version: str = 'v22.0',
) -> Dict[str, Any]:
    """
    Create a Meta campaign — parity with reference ``create_campaign`` (POST ``/{act}/campaigns``).
    """
    if not account_id:
        return {'ok': False, 'error': 'account_id is required'}
    if not name:
        return {'ok': False, 'error': 'name is required'}
    if not objective:
        return {'ok': False, 'error': 'objective is required'}
    obj = str(objective).upper()
    if obj not in VALID_OBJECTIVES:
        return {
            'ok': False,
            'error': f'objective must be one of: {", ".join(sorted(VALID_OBJECTIVES))}',
        }

    act_id = ensure_act_prefix(account_id)
    user_provided_categories = special_ad_categories is not None
    categories = list(special_ad_categories) if special_ad_categories is not None else []

    compliance_warning: Optional[str] = None
    if obj == 'OUTCOME_LEADS' and not categories and not user_provided_categories:
        compliance_warning = (
            'Campaign objective is OUTCOME_LEADS but no special_ad_categories were specified. '
            'If this campaign is for a regulated industry (insurance, housing, employment, credit), '
            'set special_ad_categories (e.g., FINANCIAL_PRODUCTS_SERVICES, HOUSING, EMPLOYMENT, CREDIT).'
        )

    db_cents: Optional[Union[int, str]] = daily_budget
    lb_cents: Optional[Union[int, str]] = lifetime_budget
    if not use_adset_level_budgets and db_cents is None and lb_cents is None:
        db_cents = DEFAULT_CBO_BUDGET_CENTS

    params: Dict[str, Any] = {
        'name': name,
        'objective': obj,
        'status': status or 'PAUSED',
        'special_ad_categories': json.dumps(categories),
    }

    if not use_adset_level_budgets:
        if db_cents is not None:
            params['daily_budget'] = str(db_cents)
        if lb_cents is not None:
            params['lifetime_budget'] = str(lb_cents)
        if campaign_budget_optimization is not None:
            params['campaign_budget_optimization'] = 'true' if campaign_budget_optimization else 'false'
    else:
        params['is_adset_budget_sharing_enabled'] = 'false'

    if buying_type:
        params['buying_type'] = buying_type
    if bid_strategy and not use_adset_level_budgets:
        params['bid_strategy'] = str(bid_strategy)
    if bid_cap is not None:
        params['bid_cap'] = str(bid_cap)
    if spend_cap is not None:
        params['spend_cap'] = str(spend_cap)
    if ab_test_control_setups:
        params['ab_test_control_setups'] = json.dumps(ab_test_control_setups)

    data = _graph_or_error(
        f'{act_id}/campaigns',
        access_token,
        params=params,
        method='POST',
        api_version=api_version,
    )
    if data.get('ok') is False:
        return data
    if 'error' in data:
        err = data['error']
        return {'ok': False, 'error': format_graph_error(err) if isinstance(err, dict) else str(err), 'error_data': err}

    campaign_id = data.get('id')
    if not campaign_id:
        return {'ok': False, 'error': 'Meta API did not return campaign id', 'response': data}

    out: Dict[str, Any] = {
        'ok': True,
        'id': str(campaign_id),
        'platform_campaign_id': str(campaign_id),
        'name': name,
        'objective': obj,
        'status': status,
    }
    if use_adset_level_budgets:
        out['budget_strategy'] = 'ad_set_level'
        out['note'] = 'Campaign created with ad set level budgets. Set budgets on ad sets.'
    if compliance_warning:
        out['compliance_warning'] = compliance_warning
    return out


def update_campaign(
    access_token: str,
    *,
    campaign_id: str,
    name: Optional[str] = None,
    status: Optional[str] = None,
    special_ad_categories: Optional[List[str]] = None,
    daily_budget: Optional[Union[int, str]] = None,
    lifetime_budget: Optional[Union[int, str]] = None,
    bid_strategy: Optional[str] = None,
    bid_cap: Optional[Union[int, str]] = None,
    spend_cap: Optional[Union[int, str]] = None,
    campaign_budget_optimization: Optional[bool] = None,
    objective: Optional[str] = None,
    use_adset_level_budgets: Optional[bool] = None,
    api_version: str = 'v22.0',
) -> Dict[str, Any]:
    """
    Update a Meta campaign — parity with reference ``update_campaign`` (POST ``/{campaign_id}``).
    """
    if not campaign_id:
        return {'ok': False, 'error': 'campaign_id is required'}
    cid = str(campaign_id).strip().lstrip('/')
    params: Dict[str, Any] = {}

    if name is not None:
        params['name'] = name
    if status is not None:
        params['status'] = status
    if special_ad_categories is not None:
        params['special_ad_categories'] = json.dumps(special_ad_categories)

    if use_adset_level_budgets is not None:
        if use_adset_level_budgets:
            params['daily_budget'] = ''
            params['lifetime_budget'] = ''
            if campaign_budget_optimization is not None:
                params['campaign_budget_optimization'] = 'false'
        else:
            if daily_budget is not None:
                params['daily_budget'] = '' if daily_budget == '' else str(daily_budget)
            if lifetime_budget is not None:
                params['lifetime_budget'] = '' if lifetime_budget == '' else str(lifetime_budget)
            if campaign_budget_optimization is not None:
                params['campaign_budget_optimization'] = 'true' if campaign_budget_optimization else 'false'
    else:
        if daily_budget is not None:
            params['daily_budget'] = '' if daily_budget == '' else str(daily_budget)
        if lifetime_budget is not None:
            params['lifetime_budget'] = '' if lifetime_budget == '' else str(lifetime_budget)
        if campaign_budget_optimization is not None:
            params['campaign_budget_optimization'] = 'true' if campaign_budget_optimization else 'false'

    if bid_strategy is not None:
        params['bid_strategy'] = bid_strategy
    if bid_cap is not None:
        params['bid_cap'] = str(bid_cap)
    if spend_cap is not None:
        params['spend_cap'] = str(spend_cap)
    if objective is not None:
        params['objective'] = str(objective).upper()

    if not params:
        return {'ok': False, 'error': 'No update parameters provided'}

    data = _graph_or_error(cid, access_token, params=params, method='POST', api_version=api_version)
    if data.get('ok') is False:
        return data
    if 'error' in data:
        err = data['error']
        return {'ok': False, 'error': format_graph_error(err) if isinstance(err, dict) else str(err), 'error_data': err}

    out: Dict[str, Any] = {'ok': True, **data} if isinstance(data, dict) else {'ok': True, 'response': data}
    if use_adset_level_budgets is not None and use_adset_level_budgets:
        out['budget_strategy'] = 'ad_set_level'
        out['note'] = 'Campaign updated to ad set level budgets. Set budgets on ad sets.'
    return out
