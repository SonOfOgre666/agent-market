"""Full Display campaign publish (budget → campaign → ad group → RDA)."""

from __future__ import annotations

from typing import Any, Dict, List

from .ads import create_responsive_display_ad
from .adgroups import create_paused_ad_group
from .api import GoogleAdsException, format_google_ads_exception, load_client
from .assets import upload_image_asset
from .campaigns import _apply_campaign_schedule
from .publish_common import (
    apply_eu_political_flag,
    apply_geo_targeting_if_present,
    create_dedicated_budget,
    creatives_dict,
    final_url_from,
    text_lines,
)
from .utils import enum_value, resolve_channel_enum


def _upload_images_from_payload(
    gcfg: dict,
    customer_id: str,
    payload: dict,
    *,
    prefix: str,
) -> List[str]:
    creatives = creatives_dict(payload)
    keys = creatives.get(f'{prefix}_image_assets') or creatives.get(f'{prefix}_images') or []
    if isinstance(keys, list) and keys and all(str(x).startswith('customers/') for x in keys):
        return [str(x) for x in keys]

    raw_list = creatives.get(f'{prefix}_image_data') or payload.get(f'{prefix}_image_data') or []
    if not isinstance(raw_list, list):
        raw_list = [raw_list] if raw_list else []
    out: List[str] = []
    for i, raw in enumerate(raw_list[:5]):
        if not raw:
            continue
        up = upload_image_asset(
            gcfg,
            customer_id=customer_id,
            image_data=str(raw),
            name=f'{prefix}-{i + 1}',
        )
        if not up.get('ok'):
            raise ValueError(up.get('error') or f'upload {prefix} image failed')
        out.append(up['asset_resource_name'])
    return out


def publish_display_campaign(
    *,
    google_ads_client_config: Dict[str, Any],
    customer_id: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    client = load_client(google_ads_client_config)
    name = (payload.get('name') or 'Display Campaign').strip()
    creatives = creatives_dict(payload)
    final_url = final_url_from(payload, creatives)

    budget_rn = create_dedicated_budget(client, customer_id, name=name, budget=payload.get('budget'))

    camp_svc = client.get_service('CampaignService')
    camp_op = client.get_type('CampaignOperation')
    c = camp_op.create
    c.name = name
    c.advertising_channel_type = resolve_channel_enum(client, 'display')
    c.status = enum_value(client, 'CampaignStatusEnum', 'PAUSED')
    c.campaign_budget = budget_rn
    _apply_campaign_schedule(
        c,
        payload.get('start_date'),
        payload.get('end_date'),
        schedule_timezone=payload.get('schedule_timezone'),
    )
    c.network_settings.target_google_search = False
    c.network_settings.target_search_network = False
    c.network_settings.target_content_network = True
    c.network_settings.target_partner_search_network = False
    try:
        c.manual_cpc = client.get_type('ManualCpc')
    except (AttributeError, ValueError):
        c.maximize_clicks = client.get_type('MaximizeClicks')
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
        channel='display',
        status='PAUSED',
    )
    ad_group_rn = ag_out['ad_group_resource_name']

    marketing = _upload_images_from_payload(google_ads_client_config, customer_id, payload, prefix='marketing')
    square = _upload_images_from_payload(google_ads_client_config, customer_id, payload, prefix='square')
    logos = _upload_images_from_payload(google_ads_client_config, customer_id, payload, prefix='logo')

    headlines = text_lines(payload.get('headlines') or creatives.get('headlines'))
    descriptions = text_lines(payload.get('descriptions') or creatives.get('descriptions'))
    long_headline = str(creatives.get('long_headline') or payload.get('long_headline') or headlines[0] if headlines else '')
    business_name = str(creatives.get('business_name') or payload.get('business_name') or name)

    rda = create_responsive_display_ad(
        client,
        customer_id,
        ad_group_resource_name=ad_group_rn,
        final_url=final_url,
        headlines=headlines,
        descriptions=descriptions,
        marketing_image_assets=marketing,
        square_marketing_image_assets=square,
        long_headline=long_headline,
        business_name=business_name,
        logo_image_assets=logos or None,
        status=str(creatives.get('ad_status') or 'PAUSED'),
    )
    if rda.get('skipped') or rda.get('error'):
        raise ValueError(rda.get('error') or rda.get('reason') or 'responsive display ad failed')

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
        'platform_ad_id': rda.get('platform_ad_id'),
        'campaign_type': 'display',
    }
