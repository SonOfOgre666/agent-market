"""Shopping listing groups (product partitions) — official SUBDIVISION + UNIT tree."""

from __future__ import annotations

from typing import Any, Dict, Optional

from .api import GoogleAdsException, format_google_ads_exception
from .utils import enum_value


def create_all_products_listing_group(
    client: Any,
    customer_id: str,
    *,
    ad_group_resource_name: str,
    cpc_bid_micros: Optional[int] = None,
) -> Dict[str, Any]:
    """
    AdGroupCriterionService — all-products partition per Google Ads API shopping guide.

    Creates SUBDIVISION root (temp id -1) + UNIT "everything else" child in one mutate.
    """
    ag_rn = (ad_group_resource_name or '').strip()
    if not ag_rn:
        return {'ok': False, 'error': 'ad_group_resource_name is required'}

    ag_id = ag_rn.split('/')[-1]
    ag_criterion_svc = client.get_service('AdGroupCriterionService')
    root_temp_rn = ag_criterion_svc.ad_group_criterion_path(customer_id, ag_id, -1)

    root_op = client.get_type('AdGroupCriterionOperation')
    root = root_op.create
    root.resource_name = root_temp_rn
    root.ad_group = ag_rn
    root.status = enum_value(client, 'AdGroupCriterionStatusEnum', 'ENABLED')
    root.listing_group.type_ = enum_value(client, 'ListingGroupTypeEnum', 'SUBDIVISION')

    unit_op = client.get_type('AdGroupCriterionOperation')
    unit = unit_op.create
    unit.ad_group = ag_rn
    unit.status = enum_value(client, 'AdGroupCriterionStatusEnum', 'ENABLED')
    unit.listing_group.type_ = enum_value(client, 'ListingGroupTypeEnum', 'UNIT')
    unit.listing_group.parent_ad_group_criterion = root_temp_rn
    if cpc_bid_micros is not None and int(cpc_bid_micros) > 0:
        unit.cpc_bid_micros = int(cpc_bid_micros)

    try:
        resp = ag_criterion_svc.mutate_ad_group_criteria(
            customer_id=customer_id,
            operations=[root_op, unit_op],
        )
    except GoogleAdsException as exc:  # type: ignore[misc]
        return {'ok': False, 'error': format_google_ads_exception(exc)}

    unit_rn = resp.results[-1].resource_name
    return {
        'ok': True,
        'listing_group_resource_name': unit_rn,
        'root_resource_name': root_temp_rn,
        'criterion_id': unit_rn.split('/')[-1],
    }
