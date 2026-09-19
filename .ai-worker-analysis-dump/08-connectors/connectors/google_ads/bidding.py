"""Bidding reads (reference tools_bidding.py subset)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from .api import digits_customer_id, load_client
from .geography import _safe_date_range


def get_device_performance(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    campaign_id: Optional[str] = None,
    date_range: str = 'LAST_30_DAYS',
) -> Dict[str, Any]:
    cid = digits_customer_id(customer_id)
    camp = ''.join(c for c in str(campaign_id or '') if c.isdigit()) if campaign_id else ''
    dr = _safe_date_range(date_range)
    client = load_client(google_ads_client_config)
    ga = client.get_service('GoogleAdsService')
    q = f"""
      SELECT
        segments.device,
        campaign.id, campaign.name,
        metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions
      FROM campaign
      WHERE segments.date DURING {dr}
    """
    if camp:
        q += f' AND campaign.id = {camp}'
    items: List[Dict[str, Any]] = []
    for row in ga.search(customer_id=cid, query=q):
        items.append({
            'device': str(row.segments.device.name if hasattr(row.segments.device, 'name') else row.segments.device),
            'campaign_id': str(row.campaign.id),
            'clicks': int(row.metrics.clicks or 0),
            'impressions': int(row.metrics.impressions or 0),
            'cost': float((row.metrics.cost_micros or 0) / 1_000_000),
            'conversions': float(row.metrics.conversions or 0),
        })
    return {'ok': True, 'data': items, 'count': len(items)}


def list_bidding_strategies(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
) -> Dict[str, Any]:
    cid = digits_customer_id(customer_id)
    client = load_client(google_ads_client_config)
    ga = client.get_service('GoogleAdsService')
    q = """
      SELECT bidding_strategy.id, bidding_strategy.name, bidding_strategy.type,
             bidding_strategy.status, bidding_strategy.resource_name
      FROM bidding_strategy
      WHERE bidding_strategy.status != 'REMOVED'
    """
    items: List[Dict[str, Any]] = []
    for row in ga.search(customer_id=cid, query=q):
        bs = row.bidding_strategy
        items.append({
            'id': str(bs.id),
            'name': bs.name,
            'type': str(bs.type_.name if hasattr(bs.type_, 'name') else bs.type_),
            'status': str(bs.status.name if hasattr(bs.status, 'name') else bs.status),
            'resource_name': bs.resource_name,
        })
    return {'ok': True, 'data': items, 'count': len(items)}


def set_bid_adjustments(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    campaign_id: str,
    adjustments: Dict[str, Any],
) -> Dict[str, Any]:
    """Device and location bid modifiers on campaign (reference set_bid_adjustments)."""
    from .api import GoogleAdsException, format_google_ads_exception
    from .utils import client_enum, enum_value, resolve_enum

    cid = digits_customer_id(customer_id)
    camp = ''.join(c for c in str(campaign_id or '') if c.isdigit())
    if not cid or not camp:
        return {'ok': False, 'error': 'customer_id and campaign_id are required'}
    if not adjustments:
        return {'ok': False, 'error': 'adjustments object required (device, location)'}

    client = load_client(google_ads_client_config)
    crit_svc = client.get_service('CampaignCriterionService')
    camp_path = client.get_service('CampaignService').campaign_path(cid, camp)
    device_enum = client_enum(client, 'DeviceEnum')
    status_enum = client_enum(client, 'CampaignCriterionStatusEnum')
    geo_svc = client.get_service('GeoTargetConstantService')

    ops = []
    applied: List[Dict[str, Any]] = []

    for device_type, modifier in (adjustments.get('device') or {}).items():
        op = client.get_type('CampaignCriterionOperation')
        crit = op.create
        crit.campaign = camp_path
        dtype = str(device_type).lower()
        if dtype == 'mobile':
            crit.device.type_ = resolve_enum(device_enum, 'MOBILE', 'device')
        elif dtype == 'desktop':
            crit.device.type_ = resolve_enum(device_enum, 'DESKTOP', 'device')
        elif dtype == 'tablet':
            crit.device.type_ = resolve_enum(device_enum, 'TABLET', 'device')
        else:
            continue
        crit.bid_modifier = float(modifier)
        crit.status = resolve_enum(status_enum, 'ENABLED', 'status')
        ops.append(op)
        applied.append({'type': 'device', 'target': dtype, 'bid_modifier': float(modifier)})

    for loc_id, modifier in (adjustments.get('location') or {}).items():
        lid = ''.join(c for c in str(loc_id) if c.isdigit())
        if not lid:
            continue
        op = client.get_type('CampaignCriterionOperation')
        crit = op.create
        crit.campaign = camp_path
        crit.location.geo_target_constant = geo_svc.geo_target_constant_path(lid)
        crit.bid_modifier = float(modifier)
        crit.status = resolve_enum(status_enum, 'ENABLED', 'status')
        ops.append(op)
        applied.append({'type': 'location', 'target': lid, 'bid_modifier': float(modifier)})

    if not ops:
        return {'ok': False, 'error': 'No valid device/location adjustments'}

    try:
        resp = crit_svc.mutate_campaign_criteria(customer_id=cid, operations=ops)
    except GoogleAdsException as exc:
        return {'ok': False, 'error': format_google_ads_exception(exc)}

    return {
        'ok': True,
        'adjustments_applied': len(applied),
        'adjustments': applied,
        'resource_names': [r.resource_name for r in resp.results],
    }
