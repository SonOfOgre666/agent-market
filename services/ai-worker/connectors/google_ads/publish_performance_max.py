"""Full Performance Max campaign publish (budget → PMax → bulk asset group + assets)."""

from __future__ import annotations

from typing import Any, Dict, List

from .api import GoogleAdsException, format_google_ads_exception, load_client
from .asset_groups import create_asset_group_with_assets_bulk, create_text_asset_on_customer
from .assets import create_youtube_video_asset, upload_image_asset
from .campaigns import _apply_campaign_schedule
from .publish_common import (
    apply_eu_political_flag,
    apply_geo_targeting_if_present,
    create_dedicated_budget,
    creatives_dict,
    final_url_from,
    resolve_logo_asset,
    text_lines,
)
from .utils import enum_value, resolve_channel_enum


def _text_assets(
    client: Any,
    customer_id: str,
    lines: List[str],
    *,
    prefix: str,
) -> List[str]:
    out: List[str] = []
    for i, line in enumerate(lines):
        row = create_text_asset_on_customer(client, customer_id, text=line, name=f'{prefix}-{i + 1}')
        if not row.get('ok'):
            raise ValueError(row.get('error') or f'text asset {prefix} failed')
        out.append(row['asset_resource_name'])
    return out


def publish_performance_max_campaign(
    *,
    google_ads_client_config: Dict[str, Any],
    customer_id: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    client = load_client(google_ads_client_config)
    name = (payload.get('name') or 'Performance Max Campaign').strip()
    creatives = creatives_dict(payload)
    final_url = final_url_from(payload, creatives)
    if not final_url:
        raise ValueError('final_url is required for Performance Max')

    budget_rn = create_dedicated_budget(client, customer_id, name=name, budget=payload.get('budget'))

    camp_svc = client.get_service('CampaignService')
    camp_op = client.get_type('CampaignOperation')
    c = camp_op.create
    c.name = name
    c.advertising_channel_type = resolve_channel_enum(client, 'performance_max')
    c.status = enum_value(client, 'CampaignStatusEnum', 'PAUSED')
    c.campaign_budget = budget_rn
    _apply_campaign_schedule(
        c,
        payload.get('start_date'),
        payload.get('end_date'),
        schedule_timezone=payload.get('schedule_timezone'),
    )
    c.maximize_conversions = client.get_type('MaximizeConversions')
    apply_eu_political_flag(c, client)

    merchant_id = payload.get('merchant_id') or creatives.get('merchant_id')
    if merchant_id:
        c.shopping_setting.merchant_id = int(''.join(ch for ch in str(merchant_id) if ch.isdigit()))

    try:
        cr = camp_svc.mutate_campaigns(customer_id=customer_id, operations=[camp_op])
    except GoogleAdsException as exc:  # type: ignore[misc]
        raise ValueError(format_google_ads_exception(exc)) from exc

    campaign_rn = cr.results[0].resource_name
    campaign_id = campaign_rn.split('/')[-1]

    headlines = text_lines(creatives.get('headlines') or payload.get('headlines'))
    long_headlines = text_lines(creatives.get('long_headlines') or payload.get('long_headlines'))
    descriptions = text_lines(creatives.get('descriptions') or payload.get('descriptions'))
    business_name = str(creatives.get('business_name') or payload.get('business_name') or name)

    if len(headlines) < 3:
        raise ValueError('at least 3 headlines required for Performance Max')
    if len(long_headlines) < 1:
        long_headlines = headlines[:2]
    if len(descriptions) < 2:
        raise ValueError('at least 2 descriptions required for Performance Max')

    logo_rn = resolve_logo_asset(
        google_ads_client_config,
        customer_id,
        payload,
        creatives,
        upload_name=f'{name}-logo',
    )

    links: List[Dict[str, str]] = []
    for rn in _text_assets(client, customer_id, headlines[:5], prefix='headline'):
        links.append({'asset_resource_name': rn, 'field_type': 'HEADLINE'})
    for rn in _text_assets(client, customer_id, long_headlines[:5], prefix='long-headline'):
        links.append({'asset_resource_name': rn, 'field_type': 'LONG_HEADLINE'})
    for rn in _text_assets(client, customer_id, descriptions[:5], prefix='description'):
        links.append({'asset_resource_name': rn, 'field_type': 'DESCRIPTION'})
    bn = create_text_asset_on_customer(client, customer_id, text=business_name, name='business-name')
    links.append({'asset_resource_name': bn['asset_resource_name'], 'field_type': 'BUSINESS_NAME'})
    links.append({'asset_resource_name': logo_rn, 'field_type': 'LOGO'})

    marketing_uploaded = False
    for i, raw in enumerate((creatives.get('marketing_image_data') or [])[:5]):
        up = upload_image_asset(
            google_ads_client_config,
            customer_id=customer_id,
            image_data=str(raw),
            name=f'marketing-{i + 1}',
        )
        if not up.get('ok'):
            raise ValueError(up.get('error') or 'marketing image upload failed')
        links.append({'asset_resource_name': up['asset_resource_name'], 'field_type': 'MARKETING_IMAGE'})
        marketing_uploaded = True

    square_uploaded = False
    for i, raw in enumerate((creatives.get('square_image_data') or [])[:5]):
        up = upload_image_asset(
            google_ads_client_config,
            customer_id=customer_id,
            image_data=str(raw),
            name=f'square-{i + 1}',
        )
        if not up.get('ok'):
            raise ValueError(up.get('error') or 'square image upload failed')
        links.append({'asset_resource_name': up['asset_resource_name'], 'field_type': 'SQUARE_MARKETING_IMAGE'})
        square_uploaded = True

    if not marketing_uploaded or not square_uploaded:
        raise ValueError(
            'Performance Max requires creatives.marketing_image_data and creatives.square_image_data '
            '(at least one image each)'
        )

    yt_id = creatives.get('youtube_video_id') or payload.get('youtube_video_id')
    yt_url = creatives.get('youtube_url') or payload.get('youtube_url')
    if yt_id or yt_url:
        vid = create_youtube_video_asset(
            google_ads_client_config,
            customer_id=customer_id,
            youtube_video_id=str(yt_id) if yt_id else None,
            youtube_url=str(yt_url) if yt_url else None,
        )
        if vid.get('ok'):
            links.append({'asset_resource_name': vid['asset_resource_name'], 'field_type': 'YOUTUBE_VIDEO'})

    ag_name = str(creatives.get('asset_group_name') or f'{name} — Asset Group')
    ag_out = create_asset_group_with_assets_bulk(
        client,
        customer_id,
        campaign_resource_name=campaign_rn,
        name=ag_name,
        final_urls=[final_url],
        asset_links=links,
        status='PAUSED',
    )
    if not ag_out.get('ok'):
        raise ValueError(ag_out.get('error') or 'bulk asset group create failed')

    apply_geo_targeting_if_present(
        google_ads_client_config,
        customer_id=customer_id,
        campaign_resource_name=campaign_rn,
        payload=payload,
    )

    return {
        'ok': True,
        'platform_campaign_id': campaign_id,
        'platform_asset_group_id': ag_out.get('platform_asset_group_id'),
        'campaign_type': 'performance_max',
    }
