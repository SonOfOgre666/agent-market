"""Performance Max asset groups."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from .api import GoogleAdsException, format_google_ads_exception
from .utils import enum_value, resolve_enum, client_enum


def create_asset_group(
    client: Any,
    customer_id: str,
    *,
    campaign_resource_name: str,
    name: str,
    final_urls: List[str],
    status: str = 'PAUSED',
) -> Dict[str, Any]:
    """AssetGroupService.mutateAssetGroups."""
    camp_rn = (campaign_resource_name or '').strip()
    urls = [u.strip() for u in (final_urls or []) if u and str(u).strip()]
    if not camp_rn or not (name or '').strip() or not urls:
        return {'ok': False, 'error': 'campaign_resource_name, name, final_urls required'}

    svc = client.get_service('AssetGroupService')
    op = client.get_type('AssetGroupOperation')
    ag = op.create
    ag.name = name.strip()
    ag.campaign = camp_rn
    ag.status = resolve_enum(client_enum(client, 'AssetGroupStatusEnum'), status or 'PAUSED', 'status')
    for u in urls[:1]:
        ag.final_urls.append(u)

    try:
        resp = svc.mutate_asset_groups(customer_id=customer_id, operations=[op])
    except GoogleAdsException as exc:  # type: ignore[misc]
        return {'ok': False, 'error': format_google_ads_exception(exc)}

    rn = resp.results[0].resource_name
    return {'ok': True, 'asset_group_resource_name': rn, 'platform_asset_group_id': rn.split('/')[-1]}


def create_asset_group_with_assets_bulk(
    client: Any,
    customer_id: str,
    *,
    campaign_resource_name: str,
    name: str,
    final_urls: List[str],
    asset_links: List[Dict[str, str]],
    status: str = 'PAUSED',
    temp_asset_group_id: int = -2,
) -> Dict[str, Any]:
    """
    GoogleAdsService.Mutate — atomic AssetGroup + AssetGroupAsset ops (standard PMax).

    Pre-create Asset resources first; pass links as {asset_resource_name, field_type}.
    """
    camp_rn = (campaign_resource_name or '').strip()
    urls = [u.strip() for u in (final_urls or []) if u and str(u).strip()]
    if not camp_rn or not (name or '').strip() or not urls:
        return {'ok': False, 'error': 'campaign_resource_name, name, final_urls required'}
    if not asset_links:
        return {'ok': False, 'error': 'asset_links is required'}

    ag_svc = client.get_service('AssetGroupService')
    ag_temp_rn = ag_svc.asset_group_path(customer_id, temp_asset_group_id)
    ga_svc = client.get_service('GoogleAdsService')
    operations = []

    ag_mut = client.get_type('MutateOperation')
    ag = ag_mut.asset_group_operation.create
    ag.resource_name = ag_temp_rn
    ag.name = name.strip()
    ag.campaign = camp_rn
    ag.status = resolve_enum(
        client_enum(client, 'AssetGroupStatusEnum'),
        status or 'PAUSED',
        'status',
    )
    ag.final_urls.append(urls[0])
    operations.append(ag_mut)

    linked: List[Dict[str, str]] = []
    for row in asset_links:
        asset_rn = str(row.get('asset_resource_name') or '').strip()
        field_type = str(row.get('field_type') or '').strip().upper()
        if not asset_rn or not field_type:
            continue
        aga_mut = client.get_type('MutateOperation')
        link = aga_mut.asset_group_asset_operation.create
        link.asset_group = ag_temp_rn
        link.asset = asset_rn
        link.field_type = enum_value(client, 'AssetFieldTypeEnum', field_type)
        operations.append(aga_mut)
        linked.append({'asset_resource_name': asset_rn, 'field_type': field_type})

    if len(operations) < 2:
        return {'ok': False, 'error': 'no valid asset_links for bulk asset group mutate'}

    try:
        resp = ga_svc.mutate(customer_id=customer_id, mutate_operations=operations)
    except GoogleAdsException as exc:  # type: ignore[misc]
        return {'ok': False, 'error': format_google_ads_exception(exc)}

    ag_result_rn = None
    for result in resp.mutate_operation_responses:
        if result.asset_group_result and result.asset_group_result.resource_name:
            ag_result_rn = result.asset_group_result.resource_name
            break
    if not ag_result_rn:
        ag_result_rn = ag_temp_rn

    return {
        'ok': True,
        'asset_group_resource_name': ag_result_rn,
        'platform_asset_group_id': ag_result_rn.split('/')[-1],
        'linked': linked,
        'count': len(linked),
    }


def link_assets_to_asset_group(
    client: Any,
    customer_id: str,
    *,
    asset_group_resource_name: str,
    asset_links: List[Dict[str, str]],
) -> Dict[str, Any]:
    """
    AssetGroupAssetService — link text/image/video assets.

    asset_links: [{asset_resource_name, field_type}] where field_type is
    HEADLINE, LONG_HEADLINE, DESCRIPTION, MARKETING_IMAGE, SQUARE_MARKETING_IMAGE, LOGO, YOUTUBE_VIDEO, BUSINESS_NAME.
    """
    ag_rn = (asset_group_resource_name or '').strip()
    if not ag_rn:
        return {'ok': False, 'error': 'asset_group_resource_name is required'}
    if not asset_links:
        return {'ok': False, 'error': 'asset_links is required'}

    svc = client.get_service('AssetGroupAssetService')
    ops = []
    linked: List[Dict[str, str]] = []
    for row in asset_links:
        asset_rn = str(row.get('asset_resource_name') or '').strip()
        field_type = str(row.get('field_type') or '').strip().upper()
        if not asset_rn or not field_type:
            continue
        op = client.get_type('AssetGroupAssetOperation')
        link = op.create
        link.asset_group = ag_rn
        link.asset = asset_rn
        link.field_type = enum_value(client, 'AssetFieldTypeEnum', field_type)
        ops.append(op)
        linked.append({'asset_resource_name': asset_rn, 'field_type': field_type})

    if not ops:
        return {'ok': False, 'error': 'no valid asset_links'}

    try:
        resp = svc.mutate_asset_group_assets(customer_id=customer_id, operations=ops)
    except GoogleAdsException as exc:  # type: ignore[misc]
        return {'ok': False, 'error': format_google_ads_exception(exc)}

    names = [r.resource_name for r in resp.results]
    return {'ok': True, 'resource_names': names, 'linked': linked, 'count': len(names)}


def create_text_asset_on_customer(
    client: Any,
    customer_id: str,
    *,
    text: str,
    name: Optional[str] = None,
) -> Dict[str, Any]:
    """Create TEXT asset and return resource name."""
    line = (text or '').strip()
    if not line:
        return {'ok': False, 'error': 'text is required'}
    svc = client.get_service('AssetService')
    op = client.get_type('AssetOperation')
    asset = op.create
    asset.name = (name or line[:30]).strip()
    asset.text_asset.text = line
    asset.type_ = enum_value(client, 'AssetTypeEnum', 'TEXT')
    try:
        resp = svc.mutate_assets(customer_id=customer_id, operations=[op])
    except GoogleAdsException as exc:  # type: ignore[misc]
        return {'ok': False, 'error': format_google_ads_exception(exc)}
    rn = resp.results[0].resource_name
    return {'ok': True, 'asset_resource_name': rn, 'asset_id': rn.split('/')[-1]}
