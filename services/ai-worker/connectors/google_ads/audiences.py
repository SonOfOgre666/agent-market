"""Audience lists and ad group targeting (reference tools_audiences.py)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from .api import GoogleAdsException, digits_customer_id, format_google_ads_exception, load_client
from .utils import client_enum, enum_value, resolve_enum


def create_custom_audience(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    name: str,
    audience_type: str = 'WEBSITE_VISITORS',
    rules: Optional[Dict[str, Any]] = None,
    description: Optional[str] = None,
) -> Dict[str, Any]:
    """Create user list / remarketing audience (reference create_custom_audience)."""
    cid = digits_customer_id(customer_id)
    if not cid or not (name or '').strip():
        return {'ok': False, 'error': 'customer_id and name are required'}

    rules = dict(rules or {})
    client = load_client(google_ads_client_config)
    svc = client.get_service('UserListService')
    op = client.get_type('UserListOperation')
    ul = op.create
    ul.name = name.strip()
    ul.description = (description or f'Custom audience: {name}').strip()
    ul.membership_status = enum_value(client, 'UserListMembershipStatusEnum', 'OPEN')
    ul.membership_life_span = 540

    atype = (audience_type or 'WEBSITE_VISITORS').upper()
    if atype == 'WEBSITE_VISITORS':
        rb = ul.rule_based_user_list
        rb.prepopulation_status = enum_value(client, 'UserListPrepopulationStatusEnum', 'REQUESTED')
        rule_item = client.get_type('UserListRuleItem')
        url_val = rules.get('url_contains') or rules.get('url_equals') or rules.get('domain') or ''
        rule_item.name = 'url__'
        op_enum = client_enum(client, 'UserListStringRuleItemOperatorEnum')
        if rules.get('url_equals'):
            rule_item.string_rule_item.operator = resolve_enum(op_enum, 'EQUALS', 'operator')
            rule_item.string_rule_item.value = str(rules['url_equals'])
        else:
            rule_item.string_rule_item.operator = resolve_enum(op_enum, 'CONTAINS', 'operator')
            rule_item.string_rule_item.value = str(url_val)
        rig = client.get_type('UserListRuleItemGroup')
        rig.rule_items.append(rule_item)
        rg = client.get_type('UserListRuleGroup')
        rg.rule_item_groups.append(rig)
        rb.flexible_rule_user_list.inclusive_rule_operator = enum_value(
            client, 'UserListFlexibleRuleOperatorEnum', 'AND',
        )
        rb.flexible_rule_user_list.inclusive_operands.append(rg)
    elif atype == 'CUSTOMER_MATCH':
        ul.crm_based_user_list.upload_key_type = enum_value(
            client, 'CustomerMatchUploadKeyTypeEnum', 'CONTACT_INFO',
        )
    else:
        return {'ok': False, 'error': f'Unsupported audience_type: {audience_type}'}

    try:
        resp = svc.mutate_user_lists(customer_id=cid, operations=[op])
    except GoogleAdsException as exc:
        return {'ok': False, 'error': format_google_ads_exception(exc)}

    rn = resp.results[0].resource_name
    return {
        'ok': True,
        'audience_id': rn.split('/')[-1],
        'resource_name': rn,
        'audience_type': atype,
        'name': name,
    }


def add_audience_targeting(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    ad_group_id: str,
    audience_id: str,
    bid_modifier: Optional[float] = None,
) -> Dict[str, Any]:
    """Attach user list or interest to ad group (reference add_audience_targeting)."""
    cid = digits_customer_id(customer_id)
    agid = ''.join(c for c in str(ad_group_id) if c.isdigit())
    aid = (audience_id or '').strip()
    if not cid or not agid or not aid:
        return {'ok': False, 'error': 'customer_id, ad_group_id, audience_id required'}

    client = load_client(google_ads_client_config)
    svc = client.get_service('AdGroupCriterionService')
    op = client.get_type('AdGroupCriterionOperation')
    crit = op.create
    crit.ad_group = client.get_service('AdGroupService').ad_group_path(cid, agid)

    if aid.startswith('customers/'):
        rn = aid
        if '/userLists/' in rn:
            crit.user_list.user_list = rn
        elif '/userInterests/' in rn:
            crit.user_interest.user_interest_category = rn
        else:
            return {'ok': False, 'error': f'Unsupported audience resource: {rn}'}
    elif len(aid) >= 8 and aid.isdigit():
        rn = f'customers/{cid}/userLists/{aid}'
        crit.user_list.user_list = rn
    else:
        rn = f'customers/{cid}/userInterests/{aid}'
        crit.user_interest.user_interest_category = rn

    if bid_modifier is not None:
        crit.bid_modifier = float(bid_modifier)
    crit.status = enum_value(client, 'AdGroupCriterionStatusEnum', 'ENABLED')

    try:
        resp = svc.mutate_ad_group_criteria(customer_id=cid, operations=[op])
    except GoogleAdsException as exc:
        return {'ok': False, 'error': format_google_ads_exception(exc)}

    return {
        'ok': True,
        'audience_resource_name': rn,
        'criterion_resource_name': resp.results[0].resource_name,
    }


def list_audiences(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    limit: int = 100,
) -> Dict[str, Any]:
    """List user lists (reference list_audiences subset)."""
    cid = digits_customer_id(customer_id)
    client = load_client(google_ads_client_config)
    ga = client.get_service('GoogleAdsService')
    q = """
      SELECT user_list.id, user_list.name, user_list.description,
             user_list.membership_status, user_list.resource_name, user_list.size_for_display
      FROM user_list
      ORDER BY user_list.name
      LIMIT 200
    """
    items: List[Dict[str, Any]] = []
    for row in ga.search(customer_id=cid, query=q):
        ul = row.user_list
        items.append({
            'audience_id': str(ul.id),
            'name': ul.name,
            'description': ul.description,
            'resource_name': ul.resource_name,
            'size': int(ul.size_for_display or 0),
        })
        if len(items) >= max(1, min(int(limit or 100), 200)):
            break
    return {'ok': True, 'data': items, 'count': len(items)}
