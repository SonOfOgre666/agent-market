"""Tool: create Meta ad creative (reference create_ad_creative)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.meta_ads import create_ad_creative as connector_create_ad_creative
from tools.ads._errors import ToolValidationError
from tools.ads.meta.creative_copy import normalize_creative_copy


def _pick(payload: Dict[str, Any], creatives: Dict[str, Any], *keys: str) -> Any:
    for k in keys:
        if payload.get(k) is not None:
            return payload.get(k)
        if creatives.get(k) is not None:
            return creatives.get(k)
    return None


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')

    account_id = payload.get('ad_account_id') or payload.get('account_id')
    creatives = dict(payload.get('creatives') or {})
    if not account_id:
        raise ToolValidationError('ad_account_id is required')

    copy = normalize_creative_copy(
        message=_pick(payload, creatives, 'message'),
        messages=_pick(payload, creatives, 'messages'),
        headline=_pick(payload, creatives, 'headline'),
        headlines=_pick(payload, creatives, 'headlines'),
        description=_pick(payload, creatives, 'description'),
        descriptions=_pick(payload, creatives, 'descriptions'),
    )

    out = connector_create_ad_creative(
        token,
        account_id=str(account_id),
        image_hash=_pick(payload, creatives, 'image_hash'),
        picture_url=_pick(payload, creatives, 'picture_url'),
        name=str(_pick(payload, creatives, 'name') or 'Creative'),
        page_id=_pick(payload, creatives, 'page_id'),
        link_url=_pick(payload, creatives, 'link_url'),
        message=copy.get('message'),
        messages=copy.get('messages'),
        headline=copy.get('headline'),
        headlines=copy.get('headlines'),
        description=copy.get('description'),
        descriptions=copy.get('descriptions'),
        image_hashes=payload.get('image_hashes'),
        video_id=payload.get('video_id'),
        thumbnail_url=payload.get('thumbnail_url'),
        optimization_type=payload.get('optimization_type'),
        dynamic_creative_spec=payload.get('dynamic_creative_spec'),
        call_to_action_type=str(
            _pick(payload, creatives, 'call_to_action_type') or payload.get('call_to_action_type') or ''
        ) or None,
        lead_gen_form_id=payload.get('lead_gen_form_id'),
        instagram_actor_id=payload.get('instagram_actor_id'),
        ad_formats=payload.get('ad_formats'),
        asset_customization_rules=payload.get('asset_customization_rules'),
        creative_features_spec=payload.get('creative_features_spec'),
        phone_number=payload.get('phone_number'),
        url_tags=payload.get('url_tags'),
        caption=payload.get('caption'),
        image_crops=payload.get('image_crops'),
        object_story_id=payload.get('object_story_id'),
        disable_all_enhancements=payload.get('disable_all_enhancements'),
        event_id=payload.get('event_id'),
        reminder_data=payload.get('reminder_data'),
        videos=payload.get('videos'),
        images=payload.get('images'),
        facebook_branded_content=payload.get('facebook_branded_content'),
        instagram_branded_content=payload.get('instagram_branded_content'),
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'Meta create creative failed')
    return out
