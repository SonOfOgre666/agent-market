"""Full Video campaign publish (VIDEO + VIDEO_ACTION → VideoResponsiveAd)."""

from __future__ import annotations

from typing import Any, Dict

from .ads import create_video_responsive_ad
from .adgroups import create_paused_ad_group
from .api import GoogleAdsException, format_google_ads_exception, load_client
from .assets import create_youtube_video_asset
from .campaigns import _apply_campaign_schedule
from .publish_common import (
    apply_eu_political_flag,
    apply_geo_targeting_if_present,
    create_dedicated_budget,
    creatives_dict,
    final_url_from,
    resolve_logo_asset,
    target_cpa_micros_from_payload,
    text_lines,
)
from .utils import enum_value, resolve_channel_enum, resolve_channel_sub_type


def publish_video_campaign(
    *,
    google_ads_client_config: Dict[str, Any],
    customer_id: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    client = load_client(google_ads_client_config)
    name = (payload.get('name') or 'Video Campaign').strip()
    creatives = creatives_dict(payload)
    final_url = final_url_from(payload, creatives)
    if not final_url:
        raise ValueError('final_url is required for Video campaigns')

    sub_type = str(payload.get('advertising_channel_sub_type') or 'VIDEO_ACTION').strip().upper()

    budget_rn = create_dedicated_budget(client, customer_id, name=name, budget=payload.get('budget'))

    camp_svc = client.get_service('CampaignService')
    camp_op = client.get_type('CampaignOperation')
    c = camp_op.create
    c.name = name
    c.advertising_channel_type = resolve_channel_enum(client, 'video')
    c.advertising_channel_sub_type = resolve_channel_sub_type(client, sub_type)
    c.status = enum_value(client, 'CampaignStatusEnum', 'PAUSED')
    c.campaign_budget = budget_rn
    _apply_campaign_schedule(
        c,
        payload.get('start_date'),
        payload.get('end_date'),
        schedule_timezone=payload.get('schedule_timezone'),
    )
    c.target_cpa.target_cpa_micros = target_cpa_micros_from_payload(payload)
    apply_eu_political_flag(c, client)

    try:
        cr = camp_svc.mutate_campaigns(customer_id=customer_id, operations=[camp_op])
    except GoogleAdsException as exc:  # type: ignore[misc]
        raise ValueError(format_google_ads_exception(exc)) from exc

    campaign_rn = cr.results[0].resource_name
    campaign_id = campaign_rn.split('/')[-1]

    ag_out = create_paused_ad_group(
        client,
        customer_id,
        campaign_resource_name=campaign_rn,
        name=f'{name} — Ad Group',
        channel='video_action',
        status='PAUSED',
    )
    ad_group_rn = ag_out['ad_group_resource_name']

    yt_id = creatives.get('youtube_video_id') or payload.get('youtube_video_id')
    yt_url = creatives.get('youtube_url') or payload.get('youtube_url') or creatives.get('video_url')
    vid_asset = creatives.get('youtube_video_asset')
    if not vid_asset:
        vid_out = create_youtube_video_asset(
            google_ads_client_config,
            customer_id=customer_id,
            youtube_video_id=str(yt_id) if yt_id else None,
            youtube_url=str(yt_url) if yt_url else None,
            name=f'{name} — Video',
        )
        if not vid_out.get('ok'):
            raise ValueError(vid_out.get('error') or 'youtube video asset failed')
        vid_asset = vid_out['asset_resource_name']

    business_name = str(creatives.get('business_name') or payload.get('business_name') or name)[:25]
    logo_asset = resolve_logo_asset(
        google_ads_client_config,
        customer_id,
        payload,
        creatives,
        upload_name=f'{name}-logo',
    )
    headlines = text_lines(creatives.get('headlines') or payload.get('headlines') or payload.get('headline'))
    descriptions = text_lines(creatives.get('descriptions') or payload.get('descriptions') or payload.get('description'))
    long_headlines = text_lines(creatives.get('long_headlines') or payload.get('long_headlines'))
    if not headlines:
        headlines = [name[:30]]
    if not descriptions:
        descriptions = ['Learn more']
    cta = str(creatives.get('call_to_action') or payload.get('call_to_action') or 'Learn more')

    ad_out = create_video_responsive_ad(
        client,
        customer_id,
        ad_group_resource_name=ad_group_rn,
        final_url=final_url,
        youtube_video_asset=str(vid_asset),
        business_name=business_name,
        logo_image_asset=logo_asset,
        headlines=headlines,
        descriptions=descriptions,
        long_headlines=long_headlines or None,
        call_to_action=cta,
        status=str(creatives.get('ad_status') or 'PAUSED'),
    )
    if ad_out.get('skipped') or ad_out.get('error'):
        raise ValueError(ad_out.get('error') or ad_out.get('reason') or 'video responsive ad failed')

    apply_geo_targeting_if_present(
        google_ads_client_config,
        customer_id=customer_id,
        campaign_resource_name=campaign_rn,
        payload=payload,
    )

    return {
        'ok': True,
        'platform_campaign_id': campaign_id,
        'platform_ad_set_id': ad_group_rn.split('/')[-1],
        'platform_ad_id': ad_out.get('platform_ad_id'),
        'campaign_type': 'video',
        'advertising_channel_sub_type': sub_type,
    }
