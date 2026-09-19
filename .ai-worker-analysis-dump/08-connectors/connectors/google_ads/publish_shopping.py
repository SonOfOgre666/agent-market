"""Full Shopping campaign publish (budget → SHOPPING campaign → ad group → listing group tree)."""

from __future__ import annotations

from typing import Any, Dict

from .adgroups import create_paused_ad_group
from .api import GoogleAdsException, format_google_ads_exception, load_client
from .campaigns import _apply_campaign_schedule
from .listing_groups import create_all_products_listing_group
from .publish_common import (
    apply_eu_political_flag,
    apply_geo_targeting_if_present,
    create_dedicated_budget,
    feed_label_from_payload,
)
from .utils import enum_value, resolve_channel_enum


def publish_shopping_campaign(
    *,
    google_ads_client_config: Dict[str, Any],
    customer_id: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    client = load_client(google_ads_client_config)
    name = (payload.get('name') or 'Shopping Campaign').strip()
    merchant_id = str(
        payload.get('merchant_id')
        or (payload.get('shopping') or {}).get('merchant_id')
        or ''
    ).strip()
    if not merchant_id:
        raise ValueError('merchant_id is required for Shopping campaigns')

    feed_label = feed_label_from_payload(payload)

    budget_rn = create_dedicated_budget(client, customer_id, name=name, budget=payload.get('budget'))

    camp_svc = client.get_service('CampaignService')
    camp_op = client.get_type('CampaignOperation')
    c = camp_op.create
    c.name = name
    c.advertising_channel_type = resolve_channel_enum(client, 'shopping')
    c.status = enum_value(client, 'CampaignStatusEnum', 'PAUSED')
    c.campaign_budget = budget_rn
    _apply_campaign_schedule(
        c,
        payload.get('start_date'),
        payload.get('end_date'),
        schedule_timezone=payload.get('schedule_timezone'),
    )
    c.shopping_setting.merchant_id = int(''.join(ch for ch in merchant_id if ch.isdigit()) or merchant_id)
    if feed_label:
        c.shopping_setting.feed_label = feed_label
    c.shopping_setting.campaign_priority = int(payload.get('campaign_priority') or 0)
    c.shopping_setting.enable_local = bool(payload.get('enable_local') or False)
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
        name=f'{name} — Products',
        channel='shopping',
        status='PAUSED',
        cpc_bid_micros=payload.get('cpc_bid_micros'),
    )
    ad_group_rn = ag_out['ad_group_resource_name']

    lg = create_all_products_listing_group(
        client,
        customer_id,
        ad_group_resource_name=ad_group_rn,
        cpc_bid_micros=payload.get('cpc_bid_micros'),
    )
    if not lg.get('ok'):
        raise ValueError(lg.get('error') or 'listing group failed')

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
        'platform_ad_id': None,
        'listing_group_id': lg.get('criterion_id'),
        'campaign_type': 'shopping',
        'feed_label': feed_label or None,
    }
