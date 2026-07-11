"""Tool: publish Meta campaign — campaign, ad set, optional creative + ad."""

from __future__ import annotations

from typing import Any, Dict, Optional

from tools.ads._errors import ToolValidationError
from tools.ads.meta.create_ad import run as create_ad
from connectors.meta_ads.publish_defaults import (
    build_promoted_object,
    ensure_adset_daily_budget_cents,
    lead_form_creative_cta,
    normalize_adset_delivery,
    strip_wizard_targeting_fields,
    validate_publish_configuration,
    validate_wizard_publish_goal,
)
from tools.ads.meta.create_adset import run as create_adset
from tools.ads.meta.create_campaign import run as create_campaign
from tools.ads.meta.create_creative import run as create_creative
from tools.ads.meta.creative_copy import normalize_creative_copy
from tools.ads.meta.creative_media import (
    require_media_for_link_creative,
    require_media_for_video_creative,
    resolve_image_hash,
    resolve_video_id,
)
from tools.ads.meta.pixel_resolve import pick_pixel_id


def _objective(raw: Any) -> str:
    s = str(raw or 'OUTCOME_TRAFFIC').strip()
    aliases = {
        'traffic': 'OUTCOME_TRAFFIC',
        'awareness': 'OUTCOME_AWARENESS',
        'engagement': 'OUTCOME_ENGAGEMENT',
        'leads': 'OUTCOME_LEADS',
        'sales': 'OUTCOME_SALES',
    }
    return aliases.get(s.lower(), s.upper())


def _creative_payload(
    payload: Dict[str, Any],
    *,
    token: str,
    ad_account_id: str,
    campaign_name: str,
    image_hash: Optional[str],
) -> Dict[str, Any]:
    """Build meta_create_creative payload from publish / Mongo draft (reference create_ad_creative)."""
    creatives = dict(payload.get('creatives') or {})
    page_id = payload.get('page_id') or creatives.get('page_id')
    link_url = (creatives.get('link_url') or payload.get('link_url') or '').strip()

    copy = normalize_creative_copy(
        message=creatives.get('message') or payload.get('message'),
        messages=creatives.get('messages') or payload.get('messages'),
        headline=creatives.get('headline') or payload.get('headline'),
        headlines=creatives.get('headlines') or payload.get('headlines'),
        description=creatives.get('description') or payload.get('description'),
        descriptions=creatives.get('descriptions') or payload.get('descriptions'),
    )

    objective = _objective(payload.get('objective'))
    og = str(
        (payload.get('targeting') or {}).get('optimization_goal')
        or payload.get('optimization_goal')
        or 'LINK_CLICKS'
    )
    lead_cta = lead_form_creative_cta(objective, og)
    body: Dict[str, Any] = {
        **payload,
        'access_token': token,
        'ad_account_id': ad_account_id,
        'page_id': page_id,
        'link_url': link_url,
        'name': creatives.get('name') or f'{campaign_name} — Creative',
        **copy,
        'lead_gen_form_id': creatives.get('lead_gen_form_id') or payload.get('lead_gen_form_id'),
        'call_to_action_type': creatives.get('call_to_action_type')
        or payload.get('call_to_action_type')
        or lead_cta
        or 'LEARN_MORE',
        'object_story_id': creatives.get('object_story_id') or payload.get('object_story_id'),
        'video_id': creatives.get('video_id') or payload.get('video_id'),
        'videos': creatives.get('videos') or payload.get('videos'),
        'images': creatives.get('images') or payload.get('images'),
    }
    if image_hash:
        body['image_hash'] = image_hash
    return body


def _maybe_create_creative_and_ad(
    payload: Dict[str, Any],
    *,
    token: str,
    ad_account_id: str,
    adset_id: str,
    campaign_name: str,
) -> Dict[str, Optional[str]]:
    creatives = dict(payload.get('creatives') or {})
    link_url = (creatives.get('link_url') or payload.get('link_url') or '').strip()
    page_id = payload.get('page_id') or creatives.get('page_id')
    object_story_id = creatives.get('object_story_id') or payload.get('object_story_id')

    video_id, video_note = resolve_video_id(payload, token=token, ad_account_id=ad_account_id)
    image_hash, image_note = resolve_image_hash(payload, token=token, ad_account_id=ad_account_id)
    is_video = bool(video_id)

    if not link_url and not object_story_id and not is_video:
        return {'platform_ad_id': None, 'creative_id': None, 'note': 'No link_url, video, or object_story_id — ad set only'}

    if not page_id and not object_story_id:
        raise ToolValidationError(
            'page_id is required for link/video ads (meta_get_account_pages). '
            'object_story_id can be used without page_id for existing posts.'
        )

    if is_video and not object_story_id:
        require_media_for_video_creative(payload, video_id)
    elif link_url and not object_story_id:
        require_media_for_link_creative(payload, image_hash)

    creative_body = _creative_payload(
        payload,
        token=token,
        ad_account_id=ad_account_id,
        campaign_name=campaign_name,
        image_hash=image_hash if not is_video else None,
    )
    if video_id:
        creative_body['video_id'] = video_id

    cr = create_creative(creative_body)
    creative_id = cr.get('creative_id') or cr.get('id')
    if not creative_id:
        raise ToolValidationError(cr.get('error') or 'meta_create_creative did not return creative_id')

    ad = create_ad(
        {
            'access_token': token,
            'ad_account_id': ad_account_id,
            'adset_id': adset_id,
            'creative_id': creative_id,
            'name': f'{campaign_name} — Ad',
        }
    )
    notes = [n for n in (video_note, image_note) if n]
    out: Dict[str, Optional[str]] = {
        'creative_id': str(creative_id),
        'platform_ad_id': ad.get('platform_ad_id') or ad.get('id'),
        'note': '; '.join(notes) if notes else None,
    }
    return out


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')

    ad_account_id = payload.get('ad_account_id') or payload.get('account_id')
    if not ad_account_id:
        raise ToolValidationError('ad_account_id is required')

    name = (payload.get('name') or 'Campaign').strip()
    budget = payload.get('budget') or {}
    targeting = dict(payload.get('targeting') or {})
    objective = _objective(payload.get('objective'))
    creatives = dict(payload.get('creatives') or {})
    has_link_url = bool((creatives.get('link_url') or payload.get('link_url') or '').strip())
    has_video = bool(
        creatives.get('video_id')
        or payload.get('video_id')
        or creatives.get('video_url')
        or payload.get('video_url')
    )

    camp = create_campaign(
        {
            'access_token': token,
            'ad_account_id': str(ad_account_id),
            'name': name,
            'objective': objective,
            'status': str(payload.get('status') or 'PAUSED'),
            'budget': budget,
            'use_adset_level_budgets': True,
        }
    )
    platform_campaign_id = camp.get('platform_campaign_id') or camp.get('id')
    if not platform_campaign_id:
        raise ToolValidationError('Meta campaign creation did not return an id')

    platform_ad_set_id = None
    platform_ad_id = None
    creative_id = None
    publish_note = None

    adset_name = targeting.get('adset_name') or targeting.get('name') or f'{name} — Ad Set'
    delivery = normalize_adset_delivery(
        objective,
        optimization_goal=str(targeting.get('optimization_goal') or 'LINK_CLICKS'),
        billing_event=str(targeting.get('billing_event') or 'IMPRESSIONS'),
        destination_type=targeting.get('destination_type'),
        has_link_url=has_link_url,
        has_video=has_video,
    )
    goal_err = validate_wizard_publish_goal(
        objective,
        str(delivery['optimization_goal']),
        has_video=has_video,
    )
    if goal_err:
        raise ToolValidationError(goal_err)

    page_id = payload.get('page_id') or creatives.get('page_id')
    pixel_id = pick_pixel_id(
        payload,
        token=token,
        ad_account_id=str(ad_account_id),
    )
    promoted_object = payload.get('promoted_object')
    if promoted_object is None:
        promoted_object = build_promoted_object(
            objective,
            str(delivery['optimization_goal']),
            page_id=page_id,
            pixel_id=pixel_id,
            custom_event_type=payload.get('custom_event_type') or targeting.get('custom_event_type'),
            application_id=payload.get('application_id') or targeting.get('application_id'),
            object_store_url=payload.get('object_store_url') or targeting.get('object_store_url'),
        )

    config_err = validate_publish_configuration(
        objective,
        str(delivery['optimization_goal']),
        page_id=page_id,
        lead_gen_form_id=creatives.get('lead_gen_form_id') or payload.get('lead_gen_form_id'),
        pixel_id=pixel_id,
        application_id=payload.get('application_id') or targeting.get('application_id'),
        object_store_url=payload.get('object_store_url') or targeting.get('object_store_url'),
        has_video=has_video,
    )
    if config_err:
        raise ToolValidationError(config_err)

    daily_cents = ensure_adset_daily_budget_cents(budget)
    graph_targeting = strip_wizard_targeting_fields(targeting)

    adset = create_adset(
        {
            'access_token': token,
            'ad_account_id': str(ad_account_id),
            'campaign_id': str(platform_campaign_id),
            'name': str(adset_name),
            'objective': objective,
            'campaign_objective': objective,
            'optimization_goal': delivery['optimization_goal'],
            'billing_event': delivery['billing_event'],
            'destination_type': delivery.get('destination_type'),
            'promoted_object': promoted_object,
            'pixel_id': pixel_id,
            'application_id': payload.get('application_id') or targeting.get('application_id'),
            'object_store_url': payload.get('object_store_url') or targeting.get('object_store_url'),
            'lead_gen_form_id': creatives.get('lead_gen_form_id') or payload.get('lead_gen_form_id'),
            'status': 'PAUSED',
            'daily_budget': daily_cents,
            'targeting': graph_targeting,
            'page_id': page_id,
            'link_url': creatives.get('link_url') or payload.get('link_url'),
            'creatives': creatives,
            'use_resolve_targeting': True,
        }
    )
    platform_ad_set_id = adset.get('platform_ad_set_id') or adset.get('id')
    if not platform_ad_set_id:
        raise ToolValidationError(adset.get('error') or 'Meta ad set creation did not return an id')

    extra = _maybe_create_creative_and_ad(
        payload,
        token=token,
        ad_account_id=str(ad_account_id),
        adset_id=str(platform_ad_set_id),
        campaign_name=name,
    )
    creative_id = extra.get('creative_id')
    platform_ad_id = extra.get('platform_ad_id')
    publish_note = extra.get('note')

    result: Dict[str, Any] = {
        'ok': True,
        'platform_campaign_id': str(platform_campaign_id),
        'platform_ad_set_id': str(platform_ad_set_id) if platform_ad_set_id else None,
        'platform_ad_id': str(platform_ad_id) if platform_ad_id else None,
        'creative_id': creative_id,
        'campaign': camp,
    }
    if publish_note:
        result['note'] = publish_note
    return result
