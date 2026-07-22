"""Tool: create Meta Ads ad set (reference_ads/meta_ads/adsets.py rules)."""

from __future__ import annotations

from typing import Any, Dict, Optional

from connectors.meta_ads import create_adset as connector_create_adset
from connectors.meta_ads.publish_defaults import (
    build_promoted_object,
    ensure_adset_daily_budget_cents,
    normalize_adset_delivery,
    strip_wizard_targeting_fields,
    validate_publish_configuration,
)
from tools.ads._errors import ToolValidationError
from tools.ads.meta.pixel_resolve import pick_pixel_id


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    from tools.ads._budget_currency import convert_payload_budget

    payload, _conversion = convert_payload_budget(dict(payload or {}), platform='meta')
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')

    raw_targeting = dict(payload.get('targeting') or {})
    objective = str(
        payload.get('objective') or payload.get('campaign_objective') or 'OUTCOME_TRAFFIC'
    )
    creatives = dict(payload.get('creatives') or {})
    link_url = (creatives.get('link_url') or payload.get('link_url') or '').strip()
    has_video = bool(
        creatives.get('video_id')
        or payload.get('video_id')
        or creatives.get('video_url')
        or payload.get('video_url')
    )

    delivery = normalize_adset_delivery(
        objective,
        optimization_goal=str(
            raw_targeting.get('optimization_goal') or payload.get('optimization_goal') or 'LINK_CLICKS'
        ),
        billing_event=str(
            raw_targeting.get('billing_event') or payload.get('billing_event') or 'IMPRESSIONS'
        ),
        destination_type=raw_targeting.get('destination_type') or payload.get('destination_type'),
        has_link_url=bool(link_url),
        has_video=has_video,
    )

    page_id = payload.get('page_id') or creatives.get('page_id')
    ad_account_id = str(payload.get('ad_account_id') or payload.get('account_id') or '')
    pixel_id = pick_pixel_id(
        payload,
        token=token,
        ad_account_id=ad_account_id,
    )
    promoted_object = payload.get('promoted_object')
    if promoted_object is None:
        promoted_object = build_promoted_object(
            objective,
            str(delivery['optimization_goal']),
            page_id=page_id,
            pixel_id=pixel_id,
            custom_event_type=payload.get('custom_event_type') or raw_targeting.get('custom_event_type'),
            application_id=payload.get('application_id') or raw_targeting.get('application_id'),
            object_store_url=payload.get('object_store_url') or raw_targeting.get('object_store_url'),
        )

    config_err = validate_publish_configuration(
        objective,
        str(delivery['optimization_goal']),
        page_id=page_id,
        lead_gen_form_id=payload.get('lead_gen_form_id') or creatives.get('lead_gen_form_id'),
        pixel_id=pixel_id,
        application_id=payload.get('application_id') or raw_targeting.get('application_id'),
        object_store_url=payload.get('object_store_url') or raw_targeting.get('object_store_url'),
        has_video=has_video,
    )
    if config_err:
        raise ToolValidationError(config_err)

    daily_budget = payload.get('daily_budget')
    if daily_budget is None and not payload.get('cbo_parent'):
        daily_budget = ensure_adset_daily_budget_cents(payload.get('budget') or {})

    use_rt = bool(payload.get('use_resolve_targeting', True))
    if use_rt:
        targeting_arg = strip_wizard_targeting_fields(raw_targeting)
    else:
        targeting_arg = dict(raw_targeting)

    multi_adv = payload.get('multi_advertiser_ads')
    if multi_adv is not None:
        try:
            multi_adv = int(multi_adv)
        except (TypeError, ValueError):
            multi_adv = None

    out = connector_create_adset(
        token,
        account_id=str(payload.get('ad_account_id') or payload.get('account_id') or ''),
        campaign_id=str(payload.get('campaign_id') or payload.get('platform_campaign_id') or ''),
        name=str(payload.get('name') or raw_targeting.get('adset_name') or 'Ad Set'),
        optimization_goal=str(delivery['optimization_goal']),
        billing_event=str(delivery['billing_event']),
        status=str(payload.get('status') or 'PAUSED'),
        daily_budget=daily_budget,
        lifetime_budget=_optional_int(payload.get('lifetime_budget')),
        targeting=targeting_arg,
        destination_type=delivery.get('destination_type'),
        bid_strategy=payload.get('bid_strategy') or 'LOWEST_COST_WITHOUT_CAP',
        bid_amount=_optional_int(payload.get('bid_amount')),
        bid_constraints=payload.get('bid_constraints'),
        bid_adjustments=payload.get('bid_adjustments'),
        start_time=payload.get('start_time'),
        end_time=payload.get('end_time'),
        dsa_beneficiary=payload.get('dsa_beneficiary'),
        dsa_payor=payload.get('dsa_payor'),
        promoted_object=promoted_object,
        campaign_objective=objective,
        is_dynamic_creative=payload.get('is_dynamic_creative'),
        frequency_control_specs=payload.get('frequency_control_specs'),
        multi_advertiser_ads=multi_adv,
        regional_regulated_categories=payload.get('regional_regulated_categories'),
        regional_regulation_identities=payload.get('regional_regulation_identities'),
        attribution_spec=payload.get('attribution_spec'),
        use_resolve_targeting=use_rt,
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'Meta create ad set failed')
    return out


def _optional_int(v: Any) -> Optional[int]:
    if v is None or v == '':
        return None
    return int(v)
