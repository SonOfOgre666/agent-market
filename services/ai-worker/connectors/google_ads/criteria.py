"""Google Ads campaign criterion mutations (reference criterion.py)."""

from __future__ import annotations

from typing import Any, Dict, List

from .api import digits_customer_id, load_client
from .utils import campaign_resource_name as build_campaign_resource_name
from .utils import enum_value


def create_geo_targeting(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    campaign_resource_name: str,
    geo_target_constant_ids: List[int],
) -> Dict[str, Any]:
    """Add location targeting to a campaign."""
    cid = digits_customer_id(customer_id)
    camp_rn = (campaign_resource_name or '').strip()
    if not cid or not camp_rn:
        return {'ok': False, 'error': 'customer_id and campaign_resource_name are required'}
    ids = [int(x) for x in (geo_target_constant_ids or []) if x is not None]
    if not ids:
        return {'ok': False, 'error': 'geo_target_constant_ids is required'}

    client = load_client(google_ads_client_config)
    svc = client.get_service('CampaignCriterionService')
    geo_svc = client.get_service('GeoTargetConstantService')
    ops = []
    for geo_id in ids:
        op = client.get_type('CampaignCriterionOperation')
        crit = op.create
        crit.campaign = camp_rn
        crit.location.geo_target_constant = geo_svc.geo_target_constant_path(geo_id)
        ops.append(op)

    resp = svc.mutate_campaign_criteria(customer_id=cid, operations=ops)
    names = [r.resource_name for r in resp.results]
    return {'ok': True, 'resource_names': names}


def exclude_geo_targets(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    campaign_resource_name: str,
    geo_target_constant_ids: List[int],
) -> Dict[str, Any]:
    """Exclude locations from a campaign (negative geo targeting)."""
    cid = digits_customer_id(customer_id)
    camp_rn = (campaign_resource_name or '').strip()
    if not cid or not camp_rn:
        return {'ok': False, 'error': 'customer_id and campaign_resource_name are required'}
    ids = [int(x) for x in (geo_target_constant_ids or []) if x is not None]
    if not ids:
        return {'ok': False, 'error': 'geo_target_constant_ids is required'}

    client = load_client(google_ads_client_config)
    svc = client.get_service('CampaignCriterionService')
    geo_svc = client.get_service('GeoTargetConstantService')
    ops = []
    for geo_id in ids:
        op = client.get_type('CampaignCriterionOperation')
        crit = op.create
        crit.campaign = camp_rn
        crit.negative = True
        crit.location.geo_target_constant = geo_svc.geo_target_constant_path(geo_id)
        ops.append(op)

    resp = svc.mutate_campaign_criteria(customer_id=cid, operations=ops)
    names = [r.resource_name for r in resp.results]
    return {'ok': True, 'resource_names': names}


def create_negative_campaign_keywords(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    campaign_resource_name: str,
    keywords: List[str],
) -> Dict[str, Any]:
    """Create broad negative keywords at campaign level."""
    cid = digits_customer_id(customer_id)
    camp_rn = (campaign_resource_name or '').strip()
    if not cid or not camp_rn:
        return {'ok': False, 'error': 'customer_id and campaign_resource_name are required'}
    texts = [(k or '').strip() for k in (keywords or []) if (k or '').strip()]
    if not texts:
        return {'ok': False, 'error': 'keywords is required'}

    client = load_client(google_ads_client_config)
    svc = client.get_service('CampaignCriterionService')
    mt_enum = enum_value(client, 'KeywordMatchTypeEnum', 'BROAD')
    ops = []
    for text in texts:
        op = client.get_type('CampaignCriterionOperation')
        crit = op.create
        crit.campaign = camp_rn
        crit.negative = True
        crit.keyword.text = text
        crit.keyword.match_type = mt_enum
        ops.append(op)

    resp = svc.mutate_campaign_criteria(customer_id=cid, operations=ops)
    names = [r.resource_name for r in resp.results]
    return {'ok': True, 'resource_names': names}


def remove_campaign_criterion(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    campaign_id: str,
    criterion_id: str,
) -> Dict[str, Any]:
    """Remove a campaign criterion by campaign and criterion id."""
    cid = digits_customer_id(customer_id)
    camp_id = digits_customer_id(campaign_id) or str(campaign_id or '').strip()
    crit_id = digits_customer_id(criterion_id) or str(criterion_id or '').strip()
    if not cid or not camp_id or not crit_id:
        return {'ok': False, 'error': 'customer_id, campaign_id, and criterion_id are required'}

    client = load_client(google_ads_client_config)
    svc = client.get_service('CampaignCriterionService')
    rn = svc.campaign_criterion_path(cid, camp_id, crit_id)
    op = client.get_type('CampaignCriterionOperation')
    op.remove = rn
    resp = svc.mutate_campaign_criteria(customer_id=cid, operations=[op])
    removed = resp.results[0].resource_name
    return {'ok': True, 'removed': removed, 'resource_name': removed}


def resolve_campaign_resource_name(
    google_ads_client_config: Dict[str, Any],
    customer_id: str,
    campaign_resource_name: str | None,
    platform_campaign_id: str | None,
) -> str:
    """Build campaign resource name from explicit rn or platform id."""
    if campaign_resource_name:
        return str(campaign_resource_name).strip()
    if platform_campaign_id:
        return build_campaign_resource_name(customer_id, str(platform_campaign_id))
    return ''
