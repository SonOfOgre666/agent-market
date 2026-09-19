"""Full create/update ad creative — parity with reference_ads/meta_ads/ads.py (no MCP)."""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional, Union

from ._json_coerce import coerce_json, coerce_optional_dict, coerce_optional_list
from .api import format_graph_error, graph_request
from .creative_helpers import (
    _ALL_ENHANCEMENT_KEYS,
    _normalize_text_variants,
    _translate_asset_customization_rules,
    _translate_video_customization_rules,
    _translate_video_customization_rules_for_existing_post,
)
from .creative_mutations_support import (
    _discover_pages_for_account,
    _fail,
    _fetch_video_thumbnail,
    _ok_creative,
)
from .utils import ensure_act_prefix

logger = logging.getLogger(__name__)

_CREATIVE_DETAIL_FIELDS = (
    'id,name,status,thumbnail_url,image_url,image_hash,object_story_spec,object_type,body,title,'
    'effective_object_story_id,asset_feed_spec{images,videos,bodies,titles,descriptions,link_urls,'
    'ad_formats,call_to_action_types,optimization_type,asset_customization_rules},url_tags,link_url'
)


def create_ad_creative(
    access_token: str,
    *,
    account_id: str,
    image_hash: Optional[str] = None,
    picture_url: Optional[str] = None,
    name: Optional[str] = None,
    page_id: Optional[Union[str, int]] = None,
    link_url: Optional[str] = None,
    message: Optional[str] = None,
    messages: Optional[List[Union[str, Dict[str, Any]]]] = None,
    headline: Optional[str] = None,
    headlines: Optional[List[Union[str, Dict[str, Any]]]] = None,
    description: Optional[str] = None,
    descriptions: Optional[List[Union[str, Dict[str, Any]]]] = None,
    image_hashes: Optional[List[str]] = None,
    video_id: Optional[Union[str, int]] = None,
    thumbnail_url: Optional[str] = None,
    optimization_type: Optional[str] = None,
    dynamic_creative_spec: Optional[Dict[str, Any]] = None,
    call_to_action_type: Optional[str] = None,
    lead_gen_form_id: Optional[Union[str, int]] = None,
    instagram_actor_id: Optional[str] = None,
    ad_formats: Optional[List[str]] = None,
    asset_customization_rules: Optional[List[Dict[str, Any]]] = None,
    creative_features_spec: Optional[Dict[str, Any]] = None,
    phone_number: Optional[str] = None,
    url_tags: Optional[str] = None,
    caption: Optional[str] = None,
    image_crops: Optional[Dict[str, Any]] = None,
    object_story_id: Optional[str] = None,
    disable_all_enhancements: Optional[bool] = None,
    event_id: Optional[Union[str, int]] = None,
    reminder_data: Optional[Dict[str, Any]] = None,
    videos: Optional[List[Dict[str, Any]]] = None,
    images: Optional[List[Dict[str, Any]]] = None,
    facebook_branded_content: Optional[Dict[str, Any]] = None,
    instagram_branded_content: Optional[Dict[str, Any]] = None,
    api_version: str = 'v22.0',
) -> Dict[str, Any]:
    """POST ``/{act}/adcreatives`` — reference ``create_ad_creative``."""
    if not account_id:
        return _fail('account_id is required')

    asset_customization_rules = coerce_optional_list(asset_customization_rules)
    creative_features_spec = coerce_optional_dict(creative_features_spec)
    image_crops = coerce_optional_dict(image_crops)
    reminder_data = coerce_optional_dict(reminder_data)
    videos = coerce_optional_list(videos)
    images = coerce_optional_list(images)
    facebook_branded_content = coerce_optional_dict(facebook_branded_content)
    instagram_branded_content = coerce_optional_dict(instagram_branded_content)
    image_hashes = coerce_optional_list(image_hashes) or image_hashes
    messages = coerce_optional_list(messages) or messages
    headlines = coerce_optional_list(headlines) or headlines
    descriptions = coerce_optional_list(descriptions) or descriptions
    ad_formats = coerce_optional_list(ad_formats) or ad_formats
    dynamic_creative_spec = coerce_optional_dict(dynamic_creative_spec)

    for param_name, param_val in [
        ('image_hashes', image_hashes),
        ('messages', messages),
        ('headlines', headlines),
        ('descriptions', descriptions),
        ('ad_formats', ad_formats),
    ]:
        parsed = coerce_json(param_val, list) if isinstance(param_val, str) else param_val
        if isinstance(parsed, list):
            if param_name == 'image_hashes':
                image_hashes = parsed
            elif param_name == 'messages':
                messages = parsed
            elif param_name == 'headlines':
                headlines = parsed
            elif param_name == 'descriptions':
                descriptions = parsed
            elif param_name == 'ad_formats':
                ad_formats = parsed

    if video_id is not None:
        video_id = str(video_id)
    if instagram_actor_id is not None:
        instagram_actor_id = str(instagram_actor_id).strip('"').strip("'")
    if lead_gen_form_id is not None:
        lead_gen_form_id = str(lead_gen_form_id)
    if event_id is not None:
        event_id = str(event_id)

    media_params = sum(1 for x in (image_hash, image_hashes, video_id, videos, images) if x)
    if media_params > 1:
        return _fail(
            "Only one media source allowed. Use 'image_hash' for a single image, 'image_hashes' for multiple "
            "images, 'video_id' for a single video, 'videos' for multiple videos with placement labels, "
            "or 'images' for multiple images with placement labels."
        )
    if media_params == 0 and not object_story_id:
        return _fail(
            "No media provided. Specify 'image_hash', 'image_hashes', 'video_id', 'videos', 'images', or 'object_story_id'."
        )

    if image_hashes and len(image_hashes) > 10:
        return _fail('Maximum 10 image hashes allowed for FLEX creatives')

    if thumbnail_url and not video_id:
        return _fail(
            'thumbnail_url can only be used with video_id. For videos[], include thumbnail_url in each video entry.'
        )

    dof_multi_image_warning = None
    if optimization_type == 'DEGREES_OF_FREEDOM' and image_hashes and len(image_hashes) > 1:
        dof_multi_image_warning = (
            f'DEGREES_OF_FREEDOM mode with {len(image_hashes)} image_hashes: Meta will only serve '
            'ONE image at delivery time. Multiple image_hashes are accepted by the API but silently '
            'collapsed at serving. To use multiple images, remove optimization_type and enable '
            'is_dynamic_creative on the ad set instead.'
        )

    if message and messages:
        return _fail(
            "Cannot specify both 'message' and 'messages'. Use 'message' for single text or 'messages' for multiple variants."
        )
    if headline and headlines:
        return _fail(
            "Cannot specify both 'headline' and 'headlines'. Use 'headline' for single headline or 'headlines' for multiple."
        )
    if description and descriptions:
        return _fail(
            "Cannot specify both 'description' and 'descriptions'. Use 'description' for single description or 'descriptions' for multiple."
        )

    if not link_url and not lead_gen_form_id and not object_story_id and not reminder_data:
        return _fail(
            'No link_url provided. A destination URL is required for ad creatives '
            '(unless using lead_gen_form_id, object_story_id, or reminder_data).'
        )

    creative_name = name or f'Creative {int(time.time())}'
    act_id = ensure_act_prefix(account_id)

    if not page_id and not object_story_id:
        discovered = _discover_pages_for_account(act_id, access_token, api_version=api_version)
        if not discovered.get('success'):
            return _fail(
                discovered.get('message') or 'No page ID and page discovery failed',
                suggestions=[
                    'Use meta_get_account_pages',
                    'Use meta_search_pages_by_name',
                    'Provide page_id manually',
                ],
            )
        page_id = discovered.get('page_id')

    if page_id is not None:
        page_id = str(page_id)

    dof_downgraded = False
    if optimization_type == 'DEGREES_OF_FREEDOM' and asset_customization_rules:
        optimization_type = None
        dof_downgraded = True

    is_video = bool(video_id or videos)
    if video_id and not thumbnail_url:
        fetched = _fetch_video_thumbnail(video_id, access_token, api_version=api_version)
        if fetched:
            thumbnail_url = fetched

    use_asset_feed = bool(
        headlines or descriptions or messages or image_hashes or videos or images
        or optimization_type or asset_customization_rules or (video_id and description)
        or (video_id and instagram_actor_id)
    )

    creative_data: Dict[str, Any] = {'name': creative_name}

    if object_story_id:
        creative_data['object_story_id'] = object_story_id
        if asset_customization_rules:
            translated, videos_array_osi = _translate_video_customization_rules_for_existing_post(
                asset_customization_rules
            )
            afs_osi: Dict[str, Any] = {}
            if videos_array_osi:
                afs_osi['videos'] = videos_array_osi
            if translated:
                afs_osi['asset_customization_rules'] = translated
            if link_url:
                afs_osi['link_urls'] = [{'website_url': link_url}]
            if call_to_action_type:
                if lead_gen_form_id or phone_number:
                    cta_val: Dict[str, Any] = {}
                    if link_url:
                        cta_val['link'] = link_url
                    if lead_gen_form_id:
                        cta_val['lead_gen_form_id'] = lead_gen_form_id
                    if phone_number:
                        cta_val['phone_number'] = phone_number
                    afs_osi['call_to_actions'] = [{'type': call_to_action_type, 'value': cta_val}]
                else:
                    afs_osi['call_to_action_types'] = [call_to_action_type]
            if afs_osi:
                creative_data['asset_feed_spec'] = afs_osi
        elif call_to_action_type:
            cta_osi: Dict[str, Any] = {'type': call_to_action_type}
            cta_val2: Dict[str, Any] = {}
            if link_url:
                cta_val2['link'] = link_url
            if lead_gen_form_id:
                cta_val2['lead_gen_form_id'] = lead_gen_form_id
            if phone_number:
                cta_val2['phone_number'] = phone_number
            if cta_val2:
                cta_osi['value'] = cta_val2
            creative_data['call_to_action'] = cta_osi
        if instagram_actor_id:
            creative_data['instagram_actor_id'] = instagram_actor_id

    elif use_asset_feed:
        videos_array = None
        images_array = None
        if videos:
            videos_array = []
            for v in videos:
                vid_id = str(v['video_id'])
                entry: Dict[str, Any] = {'video_id': vid_id}
                if v.get('thumbnail_url'):
                    entry['thumbnail_url'] = v['thumbnail_url']
                else:
                    fetched_thumb = _fetch_video_thumbnail(vid_id, access_token, api_version=api_version)
                    if fetched_thumb:
                        entry['thumbnail_url'] = fetched_thumb
                        logger.info('Auto-fetched thumbnail for video %s: %s...', vid_id, str(fetched_thumb)[:80])
                    else:
                        logger.warning(
                            'Could not auto-fetch thumbnail for video %s; proceeding without thumbnail_url',
                            vid_id,
                        )
                if v.get('label'):
                    entry['adlabels'] = [{'name': v['label']}]
                elif v.get('adlabels'):
                    entry['adlabels'] = v['adlabels']
                videos_array.append(entry)
        elif video_id:
            entry_v: Dict[str, Any] = {'video_id': video_id}
            if thumbnail_url:
                entry_v['thumbnail_url'] = thumbnail_url
            videos_array = [entry_v]
        elif images:
            images_array = []
            for img in images:
                row = {'hash': img.get('image_hash') or img.get('hash')}
                if img.get('label'):
                    row['adlabels'] = [{'name': img['label']}]
                elif img.get('adlabels'):
                    row['adlabels'] = img['adlabels']
                images_array.append(row)
        elif image_hashes:
            images_array = [{'hash': h} for h in image_hashes]
        elif image_hash:
            images_array = [{'hash': image_hash}]

        rules = asset_customization_rules
        if rules and images_array:
            rules, images_array = _translate_asset_customization_rules(rules, images_array)
        elif rules and videos_array:
            rules, videos_array = _translate_video_customization_rules(rules, videos_array)

        is_dof = optimization_type == 'DEGREES_OF_FREEDOM'
        if is_dof:
            asset_feed_spec: Dict[str, Any] = {'optimization_type': optimization_type}
            if ad_formats:
                asset_feed_spec['ad_formats'] = ad_formats
        else:
            resolved_formats = ad_formats or (['SINGLE_VIDEO'] if is_video else ['SINGLE_IMAGE'])
            asset_feed_spec = {
                'link_urls': [{'website_url': link_url}] if link_url else [],
                'ad_formats': resolved_formats,
            }
            if optimization_type:
                asset_feed_spec['optimization_type'] = optimization_type

        if videos_array:
            asset_feed_spec['videos'] = videos_array
        if images_array:
            asset_feed_spec['images'] = images_array
        if headlines:
            asset_feed_spec['titles'] = _normalize_text_variants(headlines)
        elif headline:
            asset_feed_spec['titles'] = [{'text': headline}]
        if descriptions:
            asset_feed_spec['descriptions'] = _normalize_text_variants(descriptions)
        elif description:
            asset_feed_spec['descriptions'] = [{'text': description}]
        if messages:
            asset_feed_spec['bodies'] = _normalize_text_variants(messages)
        elif message:
            asset_feed_spec['bodies'] = [{'text': message}]
        if call_to_action_type and not is_dof:
            if lead_gen_form_id or phone_number:
                cta_v: Dict[str, Any] = {}
                if link_url:
                    cta_v['link'] = link_url
                if lead_gen_form_id:
                    cta_v['lead_gen_form_id'] = lead_gen_form_id
                if phone_number:
                    cta_v['phone_number'] = phone_number
                asset_feed_spec['call_to_actions'] = [{'type': call_to_action_type, 'value': cta_v}]
            else:
                asset_feed_spec['call_to_action_types'] = [call_to_action_type]
        if rules:
            asset_feed_spec['asset_customization_rules'] = rules
        creative_data['asset_feed_spec'] = asset_feed_spec

        if video_id or not is_dof:
            creative_data['object_story_spec'] = {'page_id': page_id}
        else:
            link_data: Dict[str, Any] = {}
            if link_url:
                link_data['link'] = link_url
            if image_hashes:
                link_data['image_hash'] = image_hashes[0]
            elif image_hash:
                link_data['image_hash'] = image_hash
            if caption:
                link_data['caption'] = caption
            if image_crops:
                link_data['image_crops'] = image_crops
            if event_id:
                link_data['event_id'] = event_id
            if reminder_data:
                link_data['reminder_data'] = reminder_data
            if call_to_action_type:
                cta = {'type': call_to_action_type}
                cta_value: Dict[str, Any] = {}
                if link_url:
                    cta_value['link'] = link_url
                if lead_gen_form_id:
                    cta_value['lead_gen_form_id'] = lead_gen_form_id
                if phone_number:
                    cta_value['phone_number'] = phone_number
                if event_id and call_to_action_type in ('EVENT_RSVP', 'BUY_TICKETS'):
                    cta_value['event_id'] = event_id
                if cta_value:
                    cta['value'] = cta_value
                link_data['call_to_action'] = cta
            creative_data['object_story_spec'] = {'page_id': page_id, 'link_data': link_data}

    elif is_video:
        video_data: Dict[str, Any] = {'video_id': video_id}
        if thumbnail_url:
            video_data['image_url'] = thumbnail_url
        if message:
            video_data['message'] = message
        if headline:
            video_data['title'] = headline
        cta_value_v: Dict[str, Any] = {}
        if link_url:
            cta_value_v['link'] = link_url
        if lead_gen_form_id:
            cta_value_v['lead_gen_form_id'] = lead_gen_form_id
        if phone_number:
            cta_value_v['phone_number'] = phone_number
        cta_type = call_to_action_type or ('LEARN_MORE' if link_url else None)
        if cta_type:
            cta_data = {'type': cta_type}
            if cta_value_v:
                cta_data['value'] = cta_value_v
            video_data['call_to_action'] = cta_data
        creative_data['object_story_spec'] = {'page_id': page_id, 'video_data': video_data}
    else:
        link_data_simple: Dict[str, Any] = {}
        if image_hash:
            link_data_simple['image_hash'] = image_hash
        if picture_url and not image_hash:
            link_data_simple['picture'] = picture_url
        if link_url:
            link_data_simple['link'] = link_url
        creative_data['object_story_spec'] = {'page_id': page_id, 'link_data': link_data_simple}
        ld = creative_data['object_story_spec']['link_data']
        if message:
            ld['message'] = message
        if headline:
            ld['name'] = headline
        if description:
            ld['description'] = description
        if caption:
            ld['caption'] = caption
        if image_crops:
            ld['image_crops'] = image_crops
        if event_id:
            ld['event_id'] = event_id
        if reminder_data:
            ld['reminder_data'] = reminder_data
        if call_to_action_type:
            cta_s = {'type': call_to_action_type}
            cta_val_s: Dict[str, Any] = {}
            if lead_gen_form_id:
                cta_val_s['lead_gen_form_id'] = lead_gen_form_id
            if phone_number:
                cta_val_s['phone_number'] = phone_number
            if event_id and call_to_action_type in ('EVENT_RSVP', 'BUY_TICKETS'):
                cta_val_s['event_id'] = event_id
            if cta_val_s:
                cta_s['value'] = cta_val_s
            ld['call_to_action'] = cta_s

    if dynamic_creative_spec:
        creative_data['dynamic_creative_spec'] = dynamic_creative_spec
    if creative_features_spec:
        creative_data['degrees_of_freedom_spec'] = {'creative_features_spec': creative_features_spec}
    if disable_all_enhancements:
        dof = creative_data.setdefault('degrees_of_freedom_spec', {})
        cfs = dof.setdefault('creative_features_spec', {})
        for key in _ALL_ENHANCEMENT_KEYS:
            cfs.setdefault(key, {'enroll_status': 'OPT_OUT'})
        creative_data.setdefault('contextual_multi_ads', {'enroll_status': 'OPT_OUT'})
    if url_tags:
        creative_data['url_tags'] = url_tags
    if instagram_actor_id and 'object_story_spec' in creative_data:
        creative_data['object_story_spec']['instagram_user_id'] = instagram_actor_id
    if facebook_branded_content:
        creative_data['facebook_branded_content'] = facebook_branded_content
    if instagram_branded_content:
        creative_data['instagram_branded_content'] = instagram_branded_content

    try:
        data = graph_request(
            f'{act_id}/adcreatives', access_token, params=creative_data, method='POST', api_version=api_version,
        )
    except Exception as exc:
        logger.exception('create_ad_creative failed')
        return _fail('Failed to create ad creative', details=str(exc))

    if data.get('ok') is False:
        return data
    if 'error' in data:
        err = data.get('error')
        inner_msg = ''
        if isinstance(err, dict):
            inner_msg = str(err.get('message') or '')
            details = err.get('details')
            if isinstance(details, dict):
                nested = details.get('error')
                if isinstance(nested, dict):
                    inner_msg = str(nested.get('message') or inner_msg)
        elif isinstance(err, str):
            inner_msg = err
        if instagram_actor_id and (
            'valid Instagram account id' in inner_msg
            or 'instagram_actor_id' in inner_msg.lower()
        ):
            return _fail(
                'Instagram account not authorized for advertising',
                explanation=(
                    "The Meta API rejected the Instagram account ID. This usually means "
                    "your Facebook access token is missing the 'instagram_basic' permission, "
                    'which is required to use Instagram placements in ad creatives.'
                ),
                fix='Reconnect the Facebook account for this workspace to refresh permissions.',
                instagram_actor_id=instagram_actor_id,
                meta_error=inner_msg,
            )
        return {'ok': False, 'error': format_graph_error(err) if isinstance(err, dict) else str(err), 'error_data': err}

    cid = data.get('id')
    if not cid:
        return {'ok': False, 'error': 'Meta API did not return creative id', 'response': data}

    from .creatives import get_creative_details

    details_res = get_creative_details(access_token, creative_id=str(cid), api_version=api_version)
    details = details_res.get('creative') if details_res.get('ok') else None
    out = _ok_creative(str(cid), details=details, success=True)

    posted_afs = creative_data.get('asset_feed_spec') if isinstance(creative_data.get('asset_feed_spec'), dict) else None
    posted_images = posted_afs.get('images') if posted_afs else None
    posted_rules = posted_afs.get('asset_customization_rules') if posted_afs else None
    stored_afs = (details or {}).get('asset_feed_spec') if isinstance(details, dict) else None
    collapsed = bool(
        posted_images
        and len(posted_images) > 1
        and posted_rules
        and (not stored_afs or not stored_afs.get('images'))
    )

    warnings_: List[str] = []
    if dof_downgraded:
        warnings_.append(
            'optimization_type=DEGREES_OF_FREEDOM was dropped because '
            'asset_customization_rules was also provided (Meta ignores '
            'rules under DOF). The creative is stored in Placement-Asset-'
            'Customization mode, which routes each asset to its placement '
            'via rules and does not require is_dynamic_creative on the '
            'ad set. If you wanted Advantage+ auto-optimization across '
            'all assets instead, remove asset_customization_rules.'
        )
    elif dof_multi_image_warning:
        warnings_.append(dof_multi_image_warning)
    if collapsed:
        warnings_.append(
            'Meta silently rewrote this creative from multi-image '
            'asset_feed_spec to single-image object_story_spec. Only the '
            'first image will serve; asset_customization_rules were '
            'discarded. Attach the creative to an ad set with '
            'is_dynamic_creative=true, or use image_crops on a single '
            'image_hash for per-placement cropping.'
        )
    if warnings_:
        out['warning'] = warnings_[0] if len(warnings_) == 1 else warnings_
    return out


def update_ad_creative(
    access_token: str,
    *,
    creative_id: str,
    name: Optional[str] = None,
    message: Optional[str] = None,
    messages: Optional[List[Union[str, Dict[str, Any]]]] = None,
    headline: Optional[str] = None,
    headlines: Optional[List[Union[str, Dict[str, Any]]]] = None,
    description: Optional[str] = None,
    descriptions: Optional[List[Union[str, Dict[str, Any]]]] = None,
    optimization_type: Optional[str] = None,
    dynamic_creative_spec: Optional[Dict[str, Any]] = None,
    call_to_action_type: Optional[str] = None,
    lead_gen_form_id: Optional[Union[str, int]] = None,
    ad_formats: Optional[List[str]] = None,
    creative_features_spec: Optional[Dict[str, Any]] = None,
    api_version: str = 'v22.0',
) -> Dict[str, Any]:
    """POST creative update — reference ``update_ad_creative``."""
    if lead_gen_form_id is not None:
        lead_gen_form_id = str(lead_gen_form_id)
    if not creative_id:
        return _fail('creative_id is required')
    if headline and headlines:
        return _fail("Cannot specify both 'headline' and 'headlines'")
    if description and descriptions:
        return _fail("Cannot specify both 'description' and 'descriptions'")
    if message and messages:
        return _fail("Cannot specify both 'message' and 'messages'")
    if optimization_type and optimization_type != 'DEGREES_OF_FREEDOM':
        return _fail(f"Invalid optimization_type '{optimization_type}'")

    dynamic_creative_spec = coerce_optional_dict(dynamic_creative_spec)
    creative_features_spec = coerce_optional_dict(creative_features_spec)
    headlines = coerce_optional_list(headlines) or headlines
    descriptions = coerce_optional_list(descriptions) or descriptions
    messages = coerce_optional_list(messages) or messages
    ad_formats = coerce_optional_list(ad_formats) or ad_formats

    update_data: Dict[str, Any] = {}
    if name:
        update_data['name'] = name

    use_asset_feed = bool(headlines or descriptions or messages or optimization_type or dynamic_creative_spec)
    if use_asset_feed:
        asset_feed_spec: Dict[str, Any] = {'ad_formats': ad_formats or ['SINGLE_IMAGE']}
        if optimization_type:
            asset_feed_spec['optimization_type'] = optimization_type
        if headlines:
            asset_feed_spec['titles'] = _normalize_text_variants(headlines)
        elif headline:
            asset_feed_spec['titles'] = [{'text': headline}]
        if descriptions:
            asset_feed_spec['descriptions'] = _normalize_text_variants(descriptions)
        elif description:
            asset_feed_spec['descriptions'] = [{'text': description}]
        if messages:
            asset_feed_spec['bodies'] = _normalize_text_variants(messages)
        elif message:
            asset_feed_spec['bodies'] = [{'text': message}]
        if call_to_action_type:
            asset_feed_spec['call_to_action_types'] = [call_to_action_type]
        update_data['asset_feed_spec'] = asset_feed_spec
    elif message or headline or description or call_to_action_type or lead_gen_form_id:
        update_data['object_story_spec'] = {'link_data': {}}
        ld = update_data['object_story_spec']['link_data']
        if message:
            ld['message'] = message
        if headline:
            ld['name'] = headline
        if description:
            ld['description'] = description
        if call_to_action_type or lead_gen_form_id:
            cta_data: Dict[str, Any] = {}
            if call_to_action_type:
                cta_data['type'] = call_to_action_type
            if lead_gen_form_id:
                cta_data['value'] = {'lead_gen_form_id': lead_gen_form_id}
            if cta_data:
                ld['call_to_action'] = cta_data

    if dynamic_creative_spec:
        update_data['dynamic_creative_spec'] = dynamic_creative_spec
    if creative_features_spec:
        update_data['creative_features_spec'] = creative_features_spec

    if not update_data:
        return _fail('No update parameters provided')

    cid = str(creative_id).strip().lstrip('/')
    data = graph_request(cid, access_token, params=update_data, method='POST', api_version=api_version)
    if data.get('ok') is False:
        return data
    if 'error' in data:
        err = data['error']
        subcode = None
        if isinstance(err, dict):
            subcode = err.get('error_subcode')
            details = err.get('details')
            if isinstance(details, dict):
                inner = details.get('error', {})
                if isinstance(inner, dict):
                    subcode = inner.get('error_subcode') or subcode
        if subcode == 1815573:
            return _fail(
                'Content updates are not allowed on existing creatives',
                workaround='Create a new creative with meta_create_creative, then meta_update_ad with the new creative_id',
                creative_id=cid,
            )
        return {'ok': False, 'error': format_graph_error(err) if isinstance(err, dict) else str(err)}

    if data.get('id'):
        detail = graph_request(cid, access_token, params={'fields': _CREATIVE_DETAIL_FIELDS}, api_version=api_version)
        return {'ok': True, 'creative_id': cid, 'details': detail}

    return {'ok': True, **data}
