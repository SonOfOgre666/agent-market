"""Full App campaign publish (MULTI_CHANNEL + APP_CAMPAIGN + target_cpa → app ad)."""

from __future__ import annotations

from typing import Any, Dict, List

from .ads import create_app_ad
from .adgroups import create_paused_ad_group
from .api import GoogleAdsException, format_google_ads_exception, load_client
from .assets import create_youtube_video_asset, upload_image_asset
from .campaigns import _apply_campaign_schedule
from .publish_common import (
    apply_eu_political_flag,
    apply_geo_targeting_if_present,
    create_dedicated_budget,
    creatives_dict,
    target_cpa_micros_from_payload,
    text_lines,
)
from .utils import enum_value, resolve_channel_enum, resolve_channel_sub_type


def publish_app_campaign(
    *,
    google_ads_client_config: Dict[str, Any],
    customer_id: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    client = load_client(google_ads_client_config)
    name = (payload.get('name') or 'App Campaign').strip()
    creatives = creatives_dict(payload)
    app_id = str(payload.get('app_id') or creatives.get('app_id') or '').strip()
    if not app_id:
        raise ValueError('app_id is required for App campaigns')

    app_store = str(payload.get('app_store') or creatives.get('app_store') or 'GOOGLE_APP_STORE').strip().upper()
    if app_store not in ('GOOGLE_APP_STORE', 'APPLE_APP_STORE'):
        app_store = 'GOOGLE_APP_STORE'

    sub_type = str(
        payload.get('advertising_channel_sub_type')
        or payload.get('app_campaign_sub_type')
        or 'APP_CAMPAIGN'
    ).strip().upper()

    budget_rn = create_dedicated_budget(client, customer_id, name=name, budget=payload.get('budget'))

    camp_svc = client.get_service('CampaignService')
    camp_op = client.get_type('CampaignOperation')
    c = camp_op.create
    c.name = name
    c.advertising_channel_type = resolve_channel_enum(client, 'app')
    c.advertising_channel_sub_type = resolve_channel_sub_type(client, sub_type)
    c.status = enum_value(client, 'CampaignStatusEnum', 'PAUSED')
    c.campaign_budget = budget_rn
    _apply_campaign_schedule(
        c,
        payload.get('start_date'),
        payload.get('end_date'),
        schedule_timezone=payload.get('schedule_timezone'),
    )
    c.app_campaign_setting.app_id = app_id
    try:
        c.app_campaign_setting.app_store = enum_value(client, 'AppCampaignAppStoreEnum', app_store)
    except (AttributeError, TypeError, KeyError):
        c.app_campaign_setting.app_store = enum_value(client, 'AppStoreEnum', app_store)
    goal = str(payload.get('bidding_strategy_goal_type') or 'OPTIMIZE_INSTALLS_TARGET_INSTALL_COST').upper()
    c.app_campaign_setting.bidding_strategy_goal_type = enum_value(
        client,
        'AppCampaignBiddingStrategyGoalTypeEnum',
        goal,
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
        channel='app',
        status='PAUSED',
    )
    ad_group_rn = ag_out['ad_group_resource_name']

    headlines = text_lines(creatives.get('headlines') or payload.get('headlines'))
    descriptions = text_lines(creatives.get('descriptions') or payload.get('descriptions'))
    if len(headlines) < 2:
        headlines = headlines + ['Install now', 'Get the app'][: 2 - len(headlines)]
    if not descriptions:
        descriptions = ['Download today']

    image_assets: List[str] = []
    for i, raw in enumerate((creatives.get('image_data') or creatives.get('marketing_image_data') or [])[:5]):
        up = upload_image_asset(
            google_ads_client_config,
            customer_id=customer_id,
            image_data=str(raw),
            name=f'app-image-{i + 1}',
        )
        if up.get('ok'):
            image_assets.append(up['asset_resource_name'])

    youtube_assets: List[str] = []
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
            youtube_assets.append(vid['asset_resource_name'])

    ad_out = create_app_ad(
        client,
        customer_id,
        ad_group_resource_name=ad_group_rn,
        headlines=headlines,
        descriptions=descriptions,
        image_asset_resource_names=image_assets or None,
        youtube_video_assets=youtube_assets or None,
        status=str(creatives.get('ad_status') or 'PAUSED'),
    )
    if ad_out.get('skipped') or ad_out.get('error'):
        raise ValueError(ad_out.get('error') or ad_out.get('reason') or 'app ad failed')

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
        'campaign_type': 'app',
    }
