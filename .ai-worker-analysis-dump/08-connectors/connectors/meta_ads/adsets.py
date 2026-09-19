"""Meta Ads ad set reads and mutations — parity with reference_ads/meta_ads/adsets.py (no MCP)."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Union

from .api import GraphAPIError, format_graph_error, graph_request
from .targeting import resolve_targeting
from .utils import ensure_act_prefix


ADSET_LIST_FIELDS = (
    'id,name,campaign_id,status,daily_budget,lifetime_budget,targeting,bid_amount,bid_adjustments,'
    'bid_strategy,bid_constraints,optimization_goal,billing_event,start_time,end_time,created_time,'
    'updated_time,is_dynamic_creative,frequency_control_specs{event,interval_days,max_frequency},'
    'regional_regulated_categories,regional_regulation_identities'
)

ADSET_DETAIL_FIELDS = (
    'id,name,campaign_id,status,frequency_control_specs{event,interval_days,max_frequency},daily_budget,'
    'lifetime_budget,targeting,bid_amount,bid_adjustments,bid_strategy,bid_constraints,optimization_goal,'
    'billing_event,start_time,end_time,created_time,updated_time,attribution_spec,destination_type,'
    'promoted_object,pacing_type,budget_remaining,dsa_beneficiary,dsa_payor,is_dynamic_creative,'
    'regional_regulated_categories,regional_regulation_identities'
)

_STRATEGIES_REQUIRING_BID_AMOUNT = frozenset({
    'LOWEST_COST_WITH_BID_CAP',
    'COST_CAP',
    'TARGET_COST',
})


def _safe_graph_id(x: str) -> str:
    s = str(x or '').strip().lstrip('/')
    if not s or not re.match(r'^[a-zA-Z0-9_]+$', s):
        raise ValueError('Invalid id for Graph path')
    return s


def _graph_get_campaign_preflight(
    access_token: str,
    campaign_id: str,
    *,
    api_version: str,
) -> Optional[Dict[str, Any]]:
    try:
        data = graph_request(
            _safe_graph_id(campaign_id),
            access_token,
            params={'fields': 'bid_strategy,name,daily_budget,lifetime_budget'},
            method='GET',
            api_version=api_version,
        )
    except GraphAPIError:
        return None
    if not isinstance(data, dict) or 'error' in data:
        return None
    return data


def list_adsets(
    access_token: str,
    *,
    account_id: str = '',
    campaign_id: str = '',
    limit: int = 50,
    after: str = '',
    api_version: str = 'v22.0',
    timeout: float = 120.0,
) -> Dict[str, Any]:
    """
    List ad sets — reference ``get_adsets`` (``/{campaign_id}/adsets`` or ``/{act_}/adsets``).
    """
    if not access_token:
        return {'ok': False, 'error': 'access_token is required', 'data': [], 'paging': None}
    if campaign_id:
        endpoint = f'{_safe_graph_id(campaign_id)}/adsets'
    elif account_id:
        endpoint = f'{ensure_act_prefix(account_id)}/adsets'
    else:
        return {'ok': False, 'error': 'campaign_id or account_id (act_) is required', 'data': [], 'paging': None}

    params: Dict[str, Any] = {'fields': ADSET_LIST_FIELDS, 'limit': str(max(1, min(500, int(limit))))}
    if after:
        params['after'] = str(after)

    try:
        data = graph_request(endpoint, access_token, params=params, method='GET', api_version=api_version, timeout=timeout)
    except GraphAPIError as exc:
        err = exc.error_data if isinstance(exc.error_data, dict) else {'message': str(exc)}
        return {'ok': False, 'error': format_graph_error(err), 'data': [], 'paging': None}
    if data.get('ok') is False:
        return {**data, 'data': [], 'paging': None}
    if isinstance(data, dict) and 'error' in data:
        err = data['error']
        return {
            'ok': False,
            'error': format_graph_error(err) if isinstance(err, dict) else str(err),
            'data': [],
            'paging': None,
        }
    return {'ok': True, 'data': data.get('data') or [], 'paging': data.get('paging')}


def get_adset_details(
    access_token: str,
    *,
    adset_id: str,
    api_version: str = 'v22.0',
    timeout: float = 120.0,
) -> Dict[str, Any]:
    """GET ad set — reference ``get_adset_details``."""
    if not adset_id:
        return {'ok': False, 'error': 'adset_id is required'}
    aid = _safe_graph_id(adset_id)
    try:
        data = graph_request(
            aid,
            access_token,
            params={'fields': ADSET_DETAIL_FIELDS},
            method='GET',
            api_version=api_version,
            timeout=timeout,
        )
    except GraphAPIError as exc:
        err = exc.error_data if isinstance(exc.error_data, dict) else {'message': str(exc)}
        return {'ok': False, 'error': format_graph_error(err)}
    if data.get('ok') is False:
        return data
    if isinstance(data, dict) and 'error' in data:
        err = data['error']
        return {'ok': False, 'error': format_graph_error(err) if isinstance(err, dict) else str(err)}
    out = dict(data) if isinstance(data, dict) else {}
    if isinstance(out, dict) and 'frequency_control_specs' not in out:
        out['_meta'] = {
            'note': 'No frequency_control_specs in response — none set or API omitted the field.',
        }
    return {'ok': True, 'adset': out}


def _prepare_targeting_reference(targeting: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Same defaults as reference ``create_adset`` when targeting is missing/empty."""
    if not targeting:
        return {
            'age_min': 18,
            'age_max': 65,
            'geo_locations': {'countries': ['US']},
            'targeting_automation': {'advantage_audience': 1},
        }
    t = dict(targeting)
    if 'targeting_automation' not in t:
        t['targeting_automation'] = {'advantage_audience': 0}
    return t


_APP_GOALS_REQUIRING_PROMOTED = frozenset({
    'APP_INSTALLS', 'APP_INSTALLS_AND_OFFSITE_CONVERSIONS', 'VALUE',
})


def _validate_app_promoted_object(
    optimization_goal: str,
    promoted_object: Optional[Dict[str, Any]],
    *,
    campaign_objective: Optional[str] = None,
) -> Optional[str]:
    obj = str(campaign_objective or '').strip().upper()
    if obj and obj != 'OUTCOME_APP_PROMOTION':
        return None
    if optimization_goal not in _APP_GOALS_REQUIRING_PROMOTED:
        return None
    if not promoted_object or not isinstance(promoted_object, dict):
        return (
            f'promoted_object is required for {optimization_goal} '
            '(application_id, object_store_url)'
        )
    if 'application_id' not in promoted_object:
        return 'promoted_object.application_id is required for APP_INSTALLS'
    if 'object_store_url' not in promoted_object:
        return 'promoted_object.object_store_url is required for APP_INSTALLS'
    url = str(promoted_object.get('object_store_url') or '')
    if not any(p in url for p in ('apps.apple.com', 'play.google.com', 'itunes.apple.com')):
        return 'object_store_url must be an App Store or Google Play URL'
    return None


def _validate_bid_strategy_create(
    bid_strategy: Optional[str],
    bid_amount: Optional[int],
    bid_constraints: Optional[Dict[str, Any]],
) -> Optional[str]:
    if not bid_strategy:
        return None
    if bid_strategy == 'LOWEST_COST':
        return "'LOWEST_COST' is invalid — use LOWEST_COST_WITHOUT_CAP"
    if bid_strategy in _STRATEGIES_REQUIRING_BID_AMOUNT and bid_amount is None:
        return f'bid_amount is required for bid_strategy {bid_strategy}'
    if bid_strategy == 'LOWEST_COST_WITH_MIN_ROAS' and not bid_constraints:
        return 'bid_constraints with roas_average_floor is required for LOWEST_COST_WITH_MIN_ROAS'
    return None


def _preflight_cbo_conflict(
    access_token: str,
    campaign_id: str,
    *,
    daily_budget: Optional[int],
    lifetime_budget: Optional[int],
    bid_amount: Optional[int],
    bid_strategy: Optional[str],
    api_version: str,
) -> Optional[str]:
    """Reference pre-flight: CBO vs ABO budget conflict; campaign bid_strategy vs ad set bid_amount."""
    need = daily_budget is not None or lifetime_budget is not None or bid_amount is None
    if not need:
        return None
    camp = _graph_get_campaign_preflight(access_token, campaign_id, api_version=api_version)
    if not camp:
        return None
    if daily_budget is not None or lifetime_budget is not None:
        if camp.get('daily_budget') or camp.get('lifetime_budget'):
            nm = camp.get('name') or campaign_id
            bt = 'daily_budget' if camp.get('daily_budget') else 'lifetime_budget'
            return (
                f"Budget conflict: campaign '{nm}' already has {bt} (CBO). "
                'Remove ad set daily_budget/lifetime_budget or use a campaign without campaign-level budget.'
            )
    if bid_amount is None:
        cbs = camp.get('bid_strategy')
        if cbs and cbs in _STRATEGIES_REQUIRING_BID_AMOUNT:
            return (
                f'bid_amount is required: parent campaign uses bid_strategy {cbs}'
            )
    return None


def create_adset(
    access_token: str,
    *,
    account_id: str,
    campaign_id: str,
    name: str,
    optimization_goal: str,
    billing_event: str,
    status: str = 'PAUSED',
    daily_budget: Optional[int] = None,
    lifetime_budget: Optional[int] = None,
    targeting: Optional[Dict[str, Any]] = None,
    bid_amount: Optional[int] = None,
    bid_strategy: Optional[str] = None,
    bid_constraints: Optional[Dict[str, Any]] = None,
    bid_adjustments: Optional[Dict[str, Any]] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    dsa_beneficiary: Optional[str] = None,
    dsa_payor: Optional[str] = None,
    promoted_object: Optional[Dict[str, Any]] = None,
    campaign_objective: Optional[str] = None,
    destination_type: Optional[str] = None,
    is_dynamic_creative: Optional[bool] = None,
    frequency_control_specs: Optional[List[Dict[str, Any]]] = None,
    multi_advertiser_ads: Optional[int] = None,
    regional_regulated_categories: Optional[List[str]] = None,
    regional_regulation_identities: Optional[Dict[str, Any]] = None,
    attribution_spec: Optional[List[Dict[str, Any]]] = None,
    use_resolve_targeting: bool = False,
    api_version: str = 'v22.0',
) -> Dict[str, Any]:
    """
    POST ``/{act_}/adsets`` — reference ``create_adset``.

    When ``use_resolve_targeting`` is True, ``targeting`` is passed through ``resolve_targeting``
    (wizard path). Otherwise reference-style ``_prepare_targeting_reference`` is used.
    """
    if not account_id or not campaign_id or not name:
        return {'ok': False, 'error': 'account_id, campaign_id, and name are required'}
    if not optimization_goal or not billing_event:
        return {'ok': False, 'error': 'optimization_goal and billing_event are required'}

    err = _validate_app_promoted_object(
        optimization_goal,
        promoted_object,
        campaign_objective=campaign_objective,
    )
    if err:
        return {'ok': False, 'error': err}
    err = _validate_bid_strategy_create(bid_strategy, bid_amount, bid_constraints)
    if err:
        return {'ok': False, 'error': err}

    pf = _preflight_cbo_conflict(
        access_token,
        campaign_id,
        daily_budget=daily_budget,
        lifetime_budget=lifetime_budget,
        bid_amount=bid_amount,
        bid_strategy=bid_strategy,
        api_version=api_version,
    )
    if pf:
        return {'ok': False, 'error': pf}

    act_id = ensure_act_prefix(account_id)
    if use_resolve_targeting:
        tspec = resolve_targeting(targeting)
    else:
        tspec = _prepare_targeting_reference(targeting)

    params: Dict[str, Any] = {
        'name': name,
        'campaign_id': str(campaign_id),
        'status': status or 'PAUSED',
        'optimization_goal': optimization_goal,
        'billing_event': billing_event,
        'targeting': tspec,
    }
    if daily_budget is not None:
        params['daily_budget'] = str(daily_budget)
    if lifetime_budget is not None:
        params['lifetime_budget'] = str(lifetime_budget)
    if bid_amount is not None:
        params['bid_amount'] = str(bid_amount)
    if bid_strategy:
        params['bid_strategy'] = str(bid_strategy)
    if bid_constraints:
        params['bid_constraints'] = bid_constraints
    if bid_adjustments is not None:
        params['bid_adjustments'] = bid_adjustments
    if start_time:
        params['start_time'] = start_time
    if end_time:
        params['end_time'] = end_time
    if dsa_beneficiary:
        params['dsa_beneficiary'] = dsa_beneficiary
    if dsa_payor:
        params['dsa_payor'] = dsa_payor
    if promoted_object:
        params['promoted_object'] = promoted_object
    if destination_type:
        params['destination_type'] = str(destination_type)
    if is_dynamic_creative is not None:
        params['is_dynamic_creative'] = 'true' if bool(is_dynamic_creative) else 'false'
    if frequency_control_specs is not None:
        params['frequency_control_specs'] = frequency_control_specs
    if multi_advertiser_ads is not None:
        params['multi_advertiser_ads'] = str(multi_advertiser_ads)
    if regional_regulated_categories is not None:
        params['regional_regulated_categories'] = regional_regulated_categories
    if regional_regulation_identities is not None:
        params['regional_regulation_identities'] = regional_regulation_identities
    if attribution_spec is not None:
        params['attribution_spec'] = attribution_spec

    data = graph_request(
        f'{act_id}/adsets',
        access_token,
        params=params,
        method='POST',
        api_version=api_version,
    )
    if data.get('ok') is False:
        return data
    if 'error' in data:
        err = data['error']
        return {'ok': False, 'error': format_graph_error(err), 'error_data': err}

    adset_id = data.get('id')
    if not adset_id:
        return {'ok': False, 'error': 'Meta API did not return ad set id', 'response': data}

    return {
        'ok': True,
        'id': str(adset_id),
        'platform_ad_set_id': str(adset_id),
        'campaign_id': str(campaign_id),
        'name': name,
    }


def update_adset(
    access_token: str,
    *,
    adset_id: str,
    frequency_control_specs: Optional[List[Dict[str, Any]]] = None,
    bid_strategy: Optional[str] = None,
    bid_amount: Optional[int] = None,
    bid_constraints: Optional[Dict[str, Any]] = None,
    bid_adjustments: Optional[Dict[str, Any]] = None,
    name: Optional[str] = None,
    status: Optional[str] = None,
    targeting: Optional[Dict[str, Any]] = None,
    optimization_goal: Optional[str] = None,
    daily_budget: Optional[int] = None,
    lifetime_budget: Optional[int] = None,
    is_dynamic_creative: Optional[bool] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    dsa_beneficiary: Optional[str] = None,
    dsa_payor: Optional[str] = None,
    multi_advertiser_ads: Optional[int] = None,
    regional_regulated_categories: Optional[List[str]] = None,
    regional_regulation_identities: Optional[Dict[str, Any]] = None,
    attribution_spec: Optional[List[Dict[str, Any]]] = None,
    api_version: str = 'v22.0',
) -> Dict[str, Any]:
    """POST ``/{adset_id}`` — reference ``update_adset``."""
    if not adset_id:
        return {'ok': False, 'error': 'adset_id is required'}
    aid = _safe_graph_id(adset_id)

    if bid_strategy is not None:
        if bid_strategy == 'LOWEST_COST':
            return {'ok': False, 'error': "'LOWEST_COST' is invalid — use LOWEST_COST_WITHOUT_CAP"}
        if bid_strategy in _STRATEGIES_REQUIRING_BID_AMOUNT and bid_amount is None:
            return {'ok': False, 'error': f'bid_amount is required for bid_strategy {bid_strategy}'}
        if bid_strategy == 'LOWEST_COST_WITH_MIN_ROAS' and not bid_constraints:
            return {'ok': False, 'error': 'bid_constraints required for LOWEST_COST_WITH_MIN_ROAS'}

    params: Dict[str, Any] = {}
    if name is not None:
        params['name'] = name
    if frequency_control_specs is not None:
        params['frequency_control_specs'] = frequency_control_specs
    if bid_strategy is not None:
        params['bid_strategy'] = bid_strategy
    if bid_amount is not None:
        params['bid_amount'] = str(bid_amount)
    if bid_constraints is not None:
        params['bid_constraints'] = bid_constraints
    if bid_adjustments is not None:
        params['bid_adjustments'] = bid_adjustments
    if status is not None:
        params['status'] = status
    if optimization_goal is not None:
        params['optimization_goal'] = optimization_goal
    if targeting is not None:
        params['targeting'] = targeting if isinstance(targeting, dict) else targeting
    if daily_budget is not None:
        params['daily_budget'] = str(daily_budget)
    if lifetime_budget is not None:
        params['lifetime_budget'] = str(lifetime_budget)
    if is_dynamic_creative is not None:
        params['is_dynamic_creative'] = 'true' if bool(is_dynamic_creative) else 'false'
    if start_time is not None:
        params['start_time'] = start_time
    if end_time is not None:
        params['end_time'] = end_time
    if dsa_beneficiary is not None:
        params['dsa_beneficiary'] = dsa_beneficiary
    if dsa_payor is not None:
        params['dsa_payor'] = dsa_payor
    if multi_advertiser_ads is not None:
        params['multi_advertiser_ads'] = str(multi_advertiser_ads)
    if regional_regulated_categories is not None:
        params['regional_regulated_categories'] = regional_regulated_categories
    if regional_regulation_identities is not None:
        params['regional_regulation_identities'] = regional_regulation_identities
    if attribution_spec is not None:
        params['attribution_spec'] = attribution_spec

    if not params:
        return {'ok': False, 'error': 'No update parameters provided'}

    data = graph_request(aid, access_token, params=params, method='POST', api_version=api_version)
    if data.get('ok') is False:
        return data
    if 'error' in data:
        err = data['error']
        return {'ok': False, 'error': format_graph_error(err), 'error_data': err}
    return {'ok': True, **data} if isinstance(data, dict) else {'ok': True, 'response': data}
