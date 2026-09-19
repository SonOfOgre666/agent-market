"""Google Ads extensions (reference tools_extensions.py)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from .api import digits_customer_id, format_google_ads_exception, load_client
from .api import GoogleAdsException


def create_sitelink_extensions(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    campaign_id: str,
    sitelinks: List[Dict[str, str]],
) -> Dict[str, Any]:
    cid = digits_customer_id(customer_id)
    camp = ''.join(c for c in str(campaign_id or '') if c.isdigit())
    if not cid or not camp or not sitelinks:
        return {'ok': False, 'error': 'customer_id, campaign_id, and sitelinks are required'}

    client = load_client(google_ads_client_config)
    asset_svc = client.get_service('AssetService')
    camp_asset_svc = client.get_service('CampaignAssetService')
    camp_path = client.get_service('CampaignService').campaign_path(cid, camp)

    asset_ops = []
    for sl in sitelinks:
        op = client.get_type('AssetOperation')
        asset = op.create
        asset.name = f"Sitelink: {sl.get('text', '')}"
        sitelink_asset = client.get_type('SitelinkAsset')
        sitelink_asset.link_text = sl['text']
        sitelink_asset.description1 = sl.get('description1') or sl['text']
        sitelink_asset.description2 = sl.get('description2') or 'Learn more'
        asset.sitelink_asset = sitelink_asset
        asset.type_ = client.enums.AssetTypeEnum.SITELINK
        asset.final_urls.append(sl['url'])
        asset_ops.append(op)

    try:
        asset_resp = asset_svc.mutate_assets(customer_id=cid, operations=asset_ops)
    except GoogleAdsException as exc:
        return {'ok': False, 'error': format_google_ads_exception(exc)}

    camp_ops = []
    created = []
    for i, res in enumerate(asset_resp.results):
        ca_op = client.get_type('CampaignAssetOperation')
        ca = ca_op.create
        ca.campaign = camp_path
        ca.asset = res.resource_name
        ca.field_type = client.enums.AssetFieldTypeEnum.SITELINK
        camp_ops.append(ca_op)
        created.append({
            'text': sitelinks[i].get('text'),
            'url': sitelinks[i].get('url'),
            'asset_resource_name': res.resource_name,
        })

    camp_asset_svc.mutate_campaign_assets(customer_id=cid, operations=camp_ops)
    return {'ok': True, 'sitelinks': created, 'count': len(created)}


def create_callout_extensions(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    campaign_id: str,
    callouts: List[str],
) -> Dict[str, Any]:
    cid = digits_customer_id(customer_id)
    camp = ''.join(c for c in str(campaign_id or '') if c.isdigit())
    if not cid or not camp or not callouts:
        return {'ok': False, 'error': 'customer_id, campaign_id, and callouts are required'}

    client = load_client(google_ads_client_config)
    asset_svc = client.get_service('AssetService')
    camp_asset_svc = client.get_service('CampaignAssetService')
    camp_path = client.get_service('CampaignService').campaign_path(cid, camp)

    asset_ops = []
    for text in callouts:
        op = client.get_type('AssetOperation')
        asset = op.create
        asset.name = f'Callout: {text}'
        callout_asset = client.get_type('CalloutAsset')
        callout_asset.callout_text = text
        asset.callout_asset = callout_asset
        asset.type_ = client.enums.AssetTypeEnum.CALLOUT
        asset_ops.append(op)

    try:
        asset_resp = asset_svc.mutate_assets(customer_id=cid, operations=asset_ops)
    except GoogleAdsException as exc:
        return {'ok': False, 'error': format_google_ads_exception(exc)}

    camp_ops = []
    created = []
    for i, res in enumerate(asset_resp.results):
        ca_op = client.get_type('CampaignAssetOperation')
        ca = ca_op.create
        ca.campaign = camp_path
        ca.asset = res.resource_name
        ca.field_type = client.enums.AssetFieldTypeEnum.CALLOUT
        camp_ops.append(ca_op)
        created.append({'text': callouts[i], 'asset_resource_name': res.resource_name})

    camp_asset_svc.mutate_campaign_assets(customer_id=cid, operations=camp_ops)
    return {'ok': True, 'callouts': created, 'count': len(created)}


def create_structured_snippet_extensions(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    campaign_id: str,
    structured_snippets: List[Dict[str, Any]],
) -> Dict[str, Any]:
    cid = digits_customer_id(customer_id)
    camp = ''.join(c for c in str(campaign_id or '') if c.isdigit())
    if not cid or not camp or not structured_snippets:
        return {'ok': False, 'error': 'customer_id, campaign_id, structured_snippets required'}
    client = load_client(google_ads_client_config)
    asset_svc = client.get_service('AssetService')
    camp_asset_svc = client.get_service('CampaignAssetService')
    camp_path = client.get_service('CampaignService').campaign_path(cid, camp)
    asset_ops = []
    for snip in structured_snippets:
        op = client.get_type('AssetOperation')
        asset = op.create
        header = str(snip.get('header') or 'Services')[:25]
        values = [str(v).strip()[:25] for v in (snip.get('values') or []) if str(v).strip()]
        while len(values) < 3:
            values.append('Option')
        asset.name = f'Snippet: {header}'
        ss = client.get_type('StructuredSnippetAsset')
        ss.header = header
        ss.values.extend(values[:10])
        asset.structured_snippet_asset = ss
        asset.type_ = client.enums.AssetTypeEnum.STRUCTURED_SNIPPET
        asset_ops.append(op)
    asset_resp = asset_svc.mutate_assets(customer_id=cid, operations=asset_ops)
    camp_ops = []
    created = []
    for i, res in enumerate(asset_resp.results):
        ca_op = client.get_type('CampaignAssetOperation')
        ca = ca_op.create
        ca.campaign = camp_path
        ca.asset = res.resource_name
        ca.field_type = client.enums.AssetFieldTypeEnum.STRUCTURED_SNIPPET
        camp_ops.append(ca_op)
        created.append({'header': structured_snippets[i].get('header'), 'asset_resource_name': res.resource_name})
    camp_asset_svc.mutate_campaign_assets(customer_id=cid, operations=camp_ops)
    return {'ok': True, 'structured_snippets': created, 'count': len(created)}


def create_call_asset_extension(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    campaign_id: str,
    phone_number: str,
    country_code: str = 'US',
) -> Dict[str, Any]:
    """Call extension via Asset API (reference create_call_extensions, asset-based)."""
    cid = digits_customer_id(customer_id)
    camp = ''.join(c for c in str(campaign_id or '') if c.isdigit())
    phone = (phone_number or '').strip()
    if not cid or not camp or not phone:
        return {'ok': False, 'error': 'customer_id, campaign_id, phone_number required'}
    client = load_client(google_ads_client_config)
    asset_svc = client.get_service('AssetService')
    camp_asset_svc = client.get_service('CampaignAssetService')
    camp_path = client.get_service('CampaignService').campaign_path(cid, camp)
    op = client.get_type('AssetOperation')
    asset = op.create
    asset.name = f'Call: {phone}'
    call_asset = client.get_type('CallAsset')
    call_asset.phone_number = phone
    call_asset.country_code = (country_code or 'US').upper()[:2]
    asset.call_asset = call_asset
    asset.type_ = client.enums.AssetTypeEnum.CALL
    asset_resp = asset_svc.mutate_assets(customer_id=cid, operations=[op])
    rn = asset_resp.results[0].resource_name
    ca_op = client.get_type('CampaignAssetOperation')
    ca = ca_op.create
    ca.campaign = camp_path
    ca.asset = rn
    ca.field_type = client.enums.AssetFieldTypeEnum.CALL
    camp_asset_svc.mutate_campaign_assets(customer_id=cid, operations=[ca_op])
    return {'ok': True, 'phone_number': phone, 'asset_resource_name': rn}


def list_campaign_assets(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    campaign_id: str | None = None,
    field_type: str | None = None,
) -> Dict[str, Any]:
    cid = digits_customer_id(customer_id)
    camp = ''.join(c for c in str(campaign_id or '') if c.isdigit()) if campaign_id else ''
    client = load_client(google_ads_client_config)
    ga = client.get_service('GoogleAdsService')
    q = """
      SELECT
        campaign_asset.resource_name,
        campaign_asset.field_type,
        campaign_asset.status,
        asset.id, asset.name, asset.type,
        campaign.id, campaign.name
      FROM campaign_asset
      WHERE campaign_asset.status != 'REMOVED'
    """
    if camp:
        q += f' AND campaign.id = {camp}'
    if field_type:
        q += f" AND campaign_asset.field_type = '{field_type.upper()}'"
    items = []
    for row in ga.search(customer_id=cid, query=q):
        items.append({
            'resource_name': row.campaign_asset.resource_name,
            'field_type': str(row.campaign_asset.field_type.name if hasattr(row.campaign_asset.field_type, 'name') else row.campaign_asset.field_type),
            'asset_id': str(row.asset.id),
            'asset_name': row.asset.name,
            'campaign_id': str(row.campaign.id),
        })
    return {'ok': True, 'data': items, 'count': len(items)}


def remove_campaign_asset(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    resource_name: str,
) -> Dict[str, Any]:
    cid = digits_customer_id(customer_id)
    rn = (resource_name or '').strip()
    if not cid or not rn:
        return {'ok': False, 'error': 'customer_id and resource_name required'}
    client = load_client(google_ads_client_config)
    svc = client.get_service('CampaignAssetService')
    op = client.get_type('CampaignAssetOperation')
    op.remove = rn
    resp = svc.mutate_campaign_assets(customer_id=cid, operations=[op])
    return {'ok': True, 'resource_name': resp.results[0].resource_name}
