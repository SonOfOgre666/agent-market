"""Google Ads ad group mutations and list reads (reference ad_group.py)."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from .api import (
    GoogleAdsClient,
    GoogleAdsException,
    digits_customer_id,
    format_google_ads_exception,
    load_client,
)
from .utils import client_enum, enum_name, enum_value, resolve_enum


def create_ad_group(
    client: Any,
    customer_id: str,
    *,
    campaign_resource_name: str,
    name: str,
    channel: str = 'search',
    status: str = 'PAUSED',
    cpc_bid_micros: Optional[int] = None,
) -> Dict[str, Optional[str]]:
    """Create an ad group (reference create_ad_group)."""
    ch = (channel or 'search').lower()
    if ch == 'display':
        ag_type = enum_value(client, 'AdGroupTypeEnum', 'DISPLAY_STANDARD')
    elif ch == 'shopping':
        ag_type = enum_value(client, 'AdGroupTypeEnum', 'SHOPPING_PRODUCT_ADS')
    elif ch == 'video' or ch == 'video_action':
        ag_type = enum_value(client, 'AdGroupTypeEnum', 'VIDEO_RESPONSIVE')
    elif ch == 'app':
        ag_type = enum_value(client, 'AdGroupTypeEnum', 'SEARCH_STANDARD')
    elif ch == 'local':
        ag_type = enum_value(client, 'AdGroupTypeEnum', 'LOCAL')
    else:
        ag_type = enum_value(client, 'AdGroupTypeEnum', 'SEARCH_STANDARD')

    ag_svc = client.get_service('AdGroupService')
    ag_op = client.get_type('AdGroupOperation')
    ag = ag_op.create
    ag.name = name
    ag.campaign = campaign_resource_name
    ag.status = resolve_enum(
        client_enum(client, 'AdGroupStatusEnum'),
        status or 'PAUSED',
        'status',
    )
    ag.type_ = ag_type
    if cpc_bid_micros is not None and int(cpc_bid_micros) > 0:
        ag.cpc_bid_micros = int(cpc_bid_micros)

    try:
        agr = ag_svc.mutate_ad_groups(customer_id=customer_id, operations=[ag_op])
    except GoogleAdsException as exc:  # type: ignore[misc]
        raise ValueError(format_google_ads_exception(exc)) from exc
    ad_group_rn = agr.results[0].resource_name
    return {
        'ad_group_resource_name': ad_group_rn,
        'platform_ad_set_id': ad_group_rn.split('/')[-1],
        'status': (status or 'PAUSED').upper(),
        'cpc_bid_micros': int(cpc_bid_micros) if cpc_bid_micros else None,
    }


def create_paused_ad_group(
    client: Any,
    customer_id: str,
    *,
    campaign_resource_name: str,
    name: str,
    channel: str = 'search',
    status: str = 'PAUSED',
    cpc_bid_micros: Optional[int] = None,
) -> Dict[str, Optional[str]]:
    """Publish-chain default: paused ad group unless targeting overrides."""
    return create_ad_group(
        client,
        customer_id,
        campaign_resource_name=campaign_resource_name,
        name=name,
        channel=channel,
        status=status,
        cpc_bid_micros=cpc_bid_micros,
    )


def update_ad_group_status(
    google_ads_client_config: dict,
    *,
    customer_id: str,
    ad_group_resource_name: str,
    status: str,
) -> dict:
    """Update ad group status (reference update_ad_group_status)."""
    from .api import digits_customer_id, health_check, load_client
    if not health_check():
        from .api import GoogleAdsLibraryMissing

        raise GoogleAdsLibraryMissing()

    cid = digits_customer_id(customer_id)
    ag_rn = (ad_group_resource_name or '').strip()
    if not cid or not ag_rn:
        return {'ok': False, 'error': 'customer_id and ad_group_resource_name are required'}

    client = load_client(google_ads_client_config)
    svc = client.get_service('AdGroupService')
    op = client.get_type('AdGroupOperation')
    ag = op.update
    ag.resource_name = ag_rn
    ag.status = resolve_enum(client_enum(client, 'AdGroupStatusEnum'), status, 'status')

    from google.protobuf import field_mask_pb2

    op.update_mask.CopyFrom(field_mask_pb2.FieldMask(paths=['status']))
    resp = svc.mutate_ad_groups(customer_id=cid, operations=[op])
    rn = resp.results[0].resource_name
    return {'ok': True, 'resource_name': rn, 'ad_group_resource_name': rn}


def list_ad_groups(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    campaign_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 100,
) -> Dict[str, Any]:
    """List ad groups (reference list_ad_groups; meta_list_adsets parity)."""
    if GoogleAdsClient is None:
        return {'ok': False, 'error': 'google-ads library not installed'}
    cid = digits_customer_id(customer_id)
    if not cid:
        return {'ok': False, 'error': 'customer_id is required'}
    camp = ''.join(c for c in str(campaign_id or '') if c.isdigit()) if campaign_id else ''

    try:
        client = load_client(google_ads_client_config)
    except Exception as exc:
        return {'ok': False, 'error': str(exc)}

    q = """
      SELECT
        ad_group.id,
        ad_group.name,
        ad_group.status,
        ad_group.type,
        ad_group.cpc_bid_micros,
        ad_group.resource_name,
        campaign.id,
        campaign.name
      FROM ad_group
      WHERE ad_group.status != 'REMOVED'
    """
    if camp:
        q += f' AND campaign.id = {camp}'
    if status and re.match(r'^[A-Z_]+$', str(status).strip().upper()):
        q += f" AND ad_group.status = '{str(status).strip().upper()}'"
    q += ' ORDER BY ad_group.name'
    cap = max(1, min(int(limit or 100), 500))

    ga = client.get_service('GoogleAdsService')
    items: List[Dict[str, Any]] = []
    try:
        rows = ga.search(customer_id=cid, query=q)
        for row in rows:
            ag = row.ad_group
            c = row.campaign
            items.append({
                'ad_group_id': str(ag.id),
                'platform_ad_set_id': str(ag.id),
                'ad_group_name': ag.name,
                'name': ag.name,
                'status': enum_name(ag.status),
                'type': enum_name(ag.type),
                'cpc_bid_micros': int(ag.cpc_bid_micros or 0),
                'resource_name': ag.resource_name,
                'campaign_id': str(c.id or ''),
                'campaign_name': c.name or '',
            })
            if len(items) >= cap:
                break
    except GoogleAdsException as exc:  # type: ignore[misc]
        return {'ok': False, 'error': format_google_ads_exception(exc)}
    except Exception as exc:
        return {'ok': False, 'error': str(exc)}

    return {'ok': True, 'data': items, 'count': len(items)}


def get_ad_group(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    ad_group_id: str,
) -> Dict[str, Any]:
    cid = digits_customer_id(customer_id)
    agid = ''.join(c for c in str(ad_group_id) if c.isdigit())
    if not cid or not agid:
        return {'ok': False, 'error': 'customer_id and ad_group_id are required'}
    client = load_client(google_ads_client_config)
    ga = client.get_service('GoogleAdsService')
    q = f"""
      SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.type,
             ad_group.cpc_bid_micros, ad_group.resource_name,
             campaign.id, campaign.name
      FROM ad_group WHERE ad_group.id = {agid} LIMIT 1
    """
    rows = list(ga.search(customer_id=cid, query=q))
    if not rows:
        return {'ok': False, 'error': f'Ad group {agid} not found'}
    row = rows[0]
    ag = row.ad_group
    return {
        'ok': True,
        'ad_group': {
            'ad_group_id': str(ag.id),
            'name': ag.name,
            'status': enum_name(ag.status),
            'type': enum_name(ag.type),
            'cpc_bid_micros': int(ag.cpc_bid_micros or 0),
            'resource_name': ag.resource_name,
            'campaign_id': str(row.campaign.id),
        },
    }


def update_ad_group(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    ad_group_resource_name: str,
    name: Optional[str] = None,
    status: Optional[str] = None,
    cpc_bid_micros: Optional[int] = None,
) -> Dict[str, Any]:
    """Full ad group update (reference update_ad_group)."""
    from google.protobuf import field_mask_pb2

    cid = digits_customer_id(customer_id)
    ag_rn = (ad_group_resource_name or '').strip()
    if not cid or not ag_rn:
        return {'ok': False, 'error': 'customer_id and ad_group_resource_name are required'}
    client = load_client(google_ads_client_config)
    svc = client.get_service('AdGroupService')
    op = client.get_type('AdGroupOperation')
    ag = op.update
    ag.resource_name = ag_rn
    paths = []
    if name:
        ag.name = name.strip()
        paths.append('name')
    if status:
        ag.status = resolve_enum(client_enum(client, 'AdGroupStatusEnum'), status, 'status')
        paths.append('status')
    if cpc_bid_micros is not None:
        ag.cpc_bid_micros = int(cpc_bid_micros)
        paths.append('cpc_bid_micros')
    if not paths:
        return {'ok': False, 'error': 'name, status, or cpc_bid_micros required'}
    op.update_mask.CopyFrom(field_mask_pb2.FieldMask(paths=paths))
    resp = svc.mutate_ad_groups(customer_id=cid, operations=[op])
    return {'ok': True, 'resource_name': resp.results[0].resource_name}
