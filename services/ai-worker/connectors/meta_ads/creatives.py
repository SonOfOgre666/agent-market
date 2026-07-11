"""Meta Ads creative reads and mutations — parity with reference_ads/meta_ads/ads.py (no MCP)."""

from __future__ import annotations

import base64
import json
import re
import time
from typing import Any, Dict, List, Optional, Union

from .api import GraphAPIError, format_graph_error, graph_request
from .creative_helpers import (
    _ALL_ENHANCEMENT_KEYS,
    _normalize_text_variants,
    _strip_deprecated_standard_enhancements,
    _translate_asset_customization_rules,
    _translate_video_customization_rules,
    _translate_video_customization_rules_for_existing_post,
    extract_creative_image_urls,
)
from .creative_mutations_support import (
    _discover_pages_for_account,
    _download_image_bytes,
    _fail,
    _fetch_video_thumbnail,
    _graph,
    _ok_creative,
)  # _download_image_bytes used by get_ad_image_urls
from .utils import ensure_act_prefix

CREATIVE_DETAIL_FIELDS = (
    'id,name,status,thumbnail_url,image_url,image_hash,object_story_spec,object_type,body,title,'
    'effective_object_story_id,asset_feed_spec{images,videos,bodies,titles,descriptions,link_urls,'
    'ad_formats,call_to_action_types,optimization_type,asset_customization_rules},url_tags,link_url'
)

AD_CREATIVES_FIELDS = (
    'id,name,status,thumbnail_url,image_url,image_hash,object_story_spec,object_type,body,title,'
    'effective_object_story_id,asset_feed_spec,url_tags,image_urls_for_viewing,product_set_id,'
    'degrees_of_freedom_spec'
)


def _safe_graph_id(x: str) -> str:
    s = str(x or '').strip().lstrip('/')
    if not s or not re.match(r'^[a-zA-Z0-9_]+$', s):
        raise ValueError('Invalid id for Graph path')
    return s


def get_creative_details(
    access_token: str,
    *,
    creative_id: str,
    api_version: str = 'v22.0',
    timeout: float = 120.0,
) -> Dict[str, Any]:
    """GET creative — reference ``get_creative_details``."""
    if not creative_id:
        return {'ok': False, 'error': 'creative_id is required'}
    cid = _safe_graph_id(creative_id)
    try:
        data = graph_request(
            cid,
            access_token,
            params={'fields': CREATIVE_DETAIL_FIELDS},
            method='GET',
            api_version=api_version,
            timeout=timeout,
        )
    except GraphAPIError as exc:
        err = exc.error_data if isinstance(exc.error_data, dict) else {'message': str(exc)}
        return {'ok': False, 'error': format_graph_error(err)}
    if data.get('ok') is False:
        return data
    if isinstance(data, dict) and 'error' in data:
        err = data['error']
        return {'ok': False, 'error': format_graph_error(err) if isinstance(err, dict) else str(err)}

    out = dict(data) if isinstance(data, dict) else {}
    for opt_field in ('dynamic_creative_spec', 'degrees_of_freedom_spec', 'product_set_id'):
        try:
            opt = graph_request(cid, access_token, params={'fields': opt_field}, method='GET', api_version=api_version, timeout=timeout)
            if isinstance(opt, dict) and opt_field in opt:
                out[opt_field] = opt[opt_field]
        except Exception:
            pass
    ps_id = out.get('product_set_id')
    if ps_id:
        try:
            catalog_data = graph_request(str(ps_id), access_token, params={'fields': 'product_catalog{id,name}'}, api_version=api_version)
            catalog = (catalog_data.get('product_catalog') or {}) if isinstance(catalog_data, dict) else {}
            if catalog.get('id'):
                out['catalog_id'] = catalog['id']
                if catalog.get('name'):
                    out['catalog_name'] = catalog['name']
        except Exception:
            pass
    _strip_deprecated_standard_enhancements(out)
    return {'ok': True, 'creative': out}


def get_ad_creatives(
    access_token: str,
    *,
    ad_id: str,
    api_version: str = 'v22.0',
    timeout: float = 120.0,
) -> Dict[str, Any]:
    """GET ``/{ad_id}/adcreatives`` — reference ``get_ad_creatives``."""
    if not ad_id:
        return {'ok': False, 'error': 'ad_id is required', 'data': []}
    aid = _safe_graph_id(ad_id)
    try:
        data = graph_request(
            f'{aid}/adcreatives',
            access_token,
            params={'fields': AD_CREATIVES_FIELDS},
            method='GET',
            api_version=api_version,
            timeout=timeout,
        )
    except GraphAPIError as exc:
        err = exc.error_data if isinstance(exc.error_data, dict) else {'message': str(exc)}
        return {'ok': False, 'error': format_graph_error(err), 'data': []}
    if data.get('ok') is False:
        return {**data, 'data': []}
    if isinstance(data, dict) and 'error' in data:
        err = data['error']
        return {'ok': False, 'error': format_graph_error(err) if isinstance(err, dict) else str(err), 'data': []}

    rows = list(data.get('data') or [])
    image_hashes: set = set()
    for creative in rows:
        afs = creative.get('asset_feed_spec') or {}
        for image in afs.get('images') or []:
            if image.get('hash') and not image.get('url'):
                image_hashes.add(image['hash'])

    if image_hashes:
        try:
            ad_row = graph_request(aid, access_token, params={'fields': 'account_id'}, api_version=api_version)
            account_id = ad_row.get('account_id') if isinstance(ad_row, dict) else None
            if account_id:
                act = ensure_act_prefix(str(account_id))
                img_data = graph_request(
                    f'{act}/adimages',
                    access_token,
                    params={'fields': 'hash,url,width,height', 'hashes': json.dumps(list(image_hashes))},
                    api_version=api_version,
                )
                hash_to_url = {
                    img['hash']: img['url']
                    for img in (img_data.get('data') or [])
                    if isinstance(img, dict) and img.get('hash') and img.get('url')
                }
                for creative in rows:
                    afs = creative.get('asset_feed_spec') or {}
                    for image in afs.get('images') or []:
                        h = image.get('hash')
                        if h and h in hash_to_url:
                            image['url'] = hash_to_url[h]
        except Exception:
            pass

    for creative in rows:
        creative['image_urls_for_viewing'] = extract_creative_image_urls(creative)
        ps_id = creative.get('product_set_id')
        if ps_id:
            try:
                catalog_data = graph_request(str(ps_id), access_token, params={'fields': 'product_catalog{id,name}'}, api_version=api_version)
                catalog = (catalog_data.get('product_catalog') or {}) if isinstance(catalog_data, dict) else {}
                if catalog.get('id'):
                    creative['catalog_id'] = catalog['id']
                    if catalog.get('name'):
                        creative['catalog_name'] = catalog['name']
            except Exception:
                pass
        _strip_deprecated_standard_enhancements(creative)

    return {'ok': True, 'data': rows}


def get_ad_image_urls(
    access_token: str,
    *,
    ad_id: str,
    api_version: str = 'v22.0',
    include_bytes: bool = False,
) -> Dict[str, Any]:
    """
    Resolve viewable image URLs for an ad (reference ``get_ad_image``).

    When ``include_bytes`` is True, downloads the primary image and returns
    ``image_base64`` + ``mime_type`` for agent/UI vision (no MCP Image type).
    """
    aid = _safe_graph_id(ad_id)
    ad_row = graph_request(aid, access_token, params={'fields': 'creative{id},account_id'}, api_version=api_version)
    if ad_row.get('ok') is False:
        return ad_row
    if 'error' in ad_row:
        return {'ok': False, 'error': format_graph_error(ad_row['error'])}

    account_id = ad_row.get('account_id')
    creative = ad_row.get('creative') or {}
    creative_id = creative.get('id') if isinstance(creative, dict) else None

    urls: List[str] = []
    image_hashes: List[str] = []

    if creative_id:
        cd = graph_request(
            _safe_graph_id(str(creative_id)),
            access_token,
            params={'fields': 'id,name,image_hash,asset_feed_spec,image_url,thumbnail_url,image_urls_for_viewing,object_story_spec'},
            api_version=api_version,
        )
        if isinstance(cd, dict) and 'error' not in cd:
            urls.extend(extract_creative_image_urls(cd))
            if cd.get('image_hash'):
                image_hashes.append(cd['image_hash'])
            afs = cd.get('asset_feed_spec') or {}
            for image in afs.get('images') or []:
                if image.get('hash'):
                    image_hashes.append(image['hash'])

    if not urls:
        res = get_ad_creatives(access_token, ad_id=ad_id, api_version=api_version)
        if not res.get('ok'):
            return res
        for row in res.get('data') or []:
            urls.extend(extract_creative_image_urls(row))
            if row.get('image_hash'):
                image_hashes.append(row['image_hash'])
            oss = row.get('object_story_spec') or {}
            ld = oss.get('link_data') or {}
            if ld.get('image_hash'):
                image_hashes.append(ld['image_hash'])

    if account_id and image_hashes and not urls:
        act = ensure_act_prefix(str(account_id))
        import json as _json

        img_data = graph_request(
            f'{act}/adimages',
            access_token,
            params={'fields': 'hash,url,width,height', 'hashes': _json.dumps([image_hashes[0]])},
            api_version=api_version,
        )
        for row in (img_data.get('data') or []) if isinstance(img_data, dict) else []:
            if row.get('url'):
                urls.append(row['url'])

    seen: set = set()
    unique = [u for u in urls if u and u not in seen and not seen.add(u)]
    if not unique:
        return {'ok': False, 'error': 'No image URLs found for this ad'}

    out: Dict[str, Any] = {'ok': True, 'image_urls': unique, 'primary_url': unique[0], 'ad_id': aid}
    if include_bytes:
        raw = _download_image_bytes(unique[0])
        if raw:
            import base64

            out['image_base64'] = base64.b64encode(raw).decode('ascii')
            out['mime_type'] = 'image/jpeg'
        else:
            out['warning'] = 'Could not download image bytes; URLs are still available'
    return out


def get_ad_image(
    access_token: str,
    *,
    ad_id: str,
    api_version: str = 'v22.0',
) -> Dict[str, Any]:
    """Alias for ``get_ad_image_urls`` with ``include_bytes=True`` (reference ``get_ad_image``)."""
    return get_ad_image_urls(access_token, ad_id=ad_id, api_version=api_version, include_bytes=True)


def get_ad_video(
    access_token: str,
    *,
    ad_id: str = '',
    video_id: str = '',
    account_id: str = '',
    api_version: str = 'v22.0',
) -> Dict[str, Any]:
    """Video source URL + metadata — reference ``get_ad_video``."""
    if not ad_id and not video_id:
        return {'ok': False, 'error': 'Provide ad_id or video_id'}

    vid = str(video_id) if video_id else ''
    if not vid:
        res = get_ad_creatives(access_token, ad_id=str(ad_id), api_version=api_version)
        if not res.get('ok'):
            return res
        rows = res.get('data') or []
        if not rows:
            return {'ok': False, 'error': f'No creatives for ad {ad_id}'}
        creative = rows[0]
        oss = creative.get('object_story_spec') or {}
        if oss.get('video_data', {}).get('video_id'):
            vid = str(oss['video_data']['video_id'])
        if not vid:
            videos = (creative.get('asset_feed_spec') or {}).get('videos') or []
            if videos:
                vid = str(videos[0].get('video_id', ''))
        if not vid:
            return {'ok': False, 'error': 'No video in this ad creative', 'hint': 'Use meta_get_ad_image for image ads'}

    act_id = str(account_id or '').replace('act_', '')
    if not act_id and ad_id:
        try:
            ad_row = graph_request(str(ad_id), access_token, params={'fields': 'account_id'}, api_version=api_version)
            act_id = str(ad_row.get('account_id') or '').replace('act_', '')
        except Exception:
            act_id = ''

    video_fields = 'source,title,description,length,picture,thumbnails,created_time'
    video_data: Dict[str, Any] = {}

    if act_id:
        try:
            adv = graph_request(
                f'act_{act_id}/advideos',
                access_token,
                params={
                    'fields': video_fields,
                    'filtering': json.dumps([{'field': 'id', 'operator': 'IN', 'value': [vid]}]),
                },
                api_version=api_version,
            )
            rows = adv.get('data') or []
            if rows:
                video_data = rows[0]
        except Exception:
            pass

    if not video_data:
        try:
            video_data = graph_request(vid, access_token, params={'fields': video_fields}, api_version=api_version)
        except GraphAPIError as exc:
            err = exc.error_data if isinstance(exc.error_data, dict) else {'message': str(exc)}
            return {'ok': False, 'error': format_graph_error(err)}

    if isinstance(video_data, dict) and video_data.get('error'):
        return {'ok': False, 'error': format_graph_error(video_data['error'])}

    out: Dict[str, Any] = {
        'ok': True,
        'video_id': vid,
        'source_url': video_data.get('source'),
        'thumbnail_url': video_data.get('picture'),
        'title': video_data.get('title'),
        'description': video_data.get('description'),
        'duration_seconds': video_data.get('length'),
        'created_time': video_data.get('created_time'),
    }
    if ad_id:
        out['ad_id'] = str(ad_id)
    if not out.get('source_url'):
        out['warning'] = 'No source URL returned — video may be deleted or permissions missing'
    return out


def upload_ad_image(
    access_token: str,
    *,
    account_id: str,
    file: Optional[str] = None,
    image_url: Optional[str] = None,
    name: Optional[str] = None,
    api_version: str = 'v22.0',
) -> Dict[str, Any]:
    """POST ``/{act}/adimages`` — reference ``upload_ad_image``."""
    if not account_id:
        return _fail('account_id is required')
    if not file and not image_url:
        return _fail("Provide either 'file' (data URL or base64) or 'image_url'")

    act_id = ensure_act_prefix(account_id)
    encoded_image = ''
    inferred_name = name or ''

    if file:
        if file.startswith('data:') and 'base64,' in file:
            header, encoded_image = file.split('base64,', 1)
            encoded_image = encoded_image.strip()
            if not inferred_name:
                mime = header[5:].split(';')[0].strip()
                ext_map = {'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif'}
                inferred_name = f'upload{ext_map.get(mime, ".png")}'
        else:
            encoded_image = file.strip()
            if not inferred_name:
                inferred_name = 'upload.png'
    else:
        image_bytes = _download_image_bytes(str(image_url))
        if not image_bytes:
            return _fail('Could not download image from image_url', image_url=image_url)
        encoded_image = base64.b64encode(image_bytes).decode('utf-8')
        if not inferred_name:
            try:
                inferred_name = str(image_url).split('?')[0].rsplit('/', 1)[-1] or 'upload.jpg'
            except Exception:
                inferred_name = 'upload.jpg'

    final_name = name or inferred_name or 'upload.png'
    data = graph_request(
        f'{act_id}/adimages',
        access_token,
        params={'bytes': encoded_image, 'name': final_name},
        method='POST',
        api_version=api_version,
    )
    if data.get('ok') is False:
        return data
    if 'error' in data:
        return {'ok': False, 'error': format_graph_error(data['error'])}

    images_dict = data.get('images') if isinstance(data, dict) else None
    if isinstance(images_dict, dict) and images_dict:
        images_list = []
        for hash_key, info in images_dict.items():
            if not isinstance(info, dict):
                continue
            images_list.append({
                'hash': info.get('hash') or hash_key,
                'url': info.get('url'),
                'width': info.get('width'),
                'height': info.get('height'),
                'name': info.get('name'),
            })
        images_list.sort(key=lambda i: i.get('hash', ''))
        primary = images_list[0].get('hash') if images_list else None
        return {
            'ok': True,
            'image_hash': primary,
            'images': images_list,
            'name': final_name,
        }
    return {'ok': True, 'raw_response': data, 'name': final_name}


def upload_ad_video(
    access_token: str,
    *,
    account_id: str,
    video_url: Optional[str] = None,
    file: Optional[str] = None,
    name: Optional[str] = None,
    api_version: str = 'v22.0',
) -> Dict[str, Any]:
    """POST ``/{act}/advideos`` — hosted URL or base64 ``source`` (reference: video_id for create_ad_creative)."""
    if not account_id:
        return _fail('account_id is required')
    if not video_url and not file:
        return _fail("Provide 'video_url' (public HTTPS) or 'file' (base64 / data URL)")

    act_id = ensure_act_prefix(account_id)
    params: Dict[str, Any] = {}
    final_name = name or 'upload.mp4'

    if video_url:
        params['file_url'] = str(video_url).strip()
        if not name:
            try:
                final_name = str(video_url).split('?')[0].rsplit('/', 1)[-1] or 'upload.mp4'
            except Exception:
                final_name = 'upload.mp4'
    else:
        encoded = ''
        if file and file.startswith('data:') and 'base64,' in file:
            _, encoded = file.split('base64,', 1)
            encoded = encoded.strip()
        elif file:
            encoded = file.strip()
        if not encoded:
            return _fail('Invalid file payload for video upload')
        params['source'] = encoded
        if not name and file.startswith('data:'):
            final_name = 'upload.mp4'

    params['name'] = final_name
    data = graph_request(
        f'{act_id}/advideos',
        access_token,
        params=params,
        method='POST',
        api_version=api_version,
    )
    if data.get('ok') is False:
        return data
    if 'error' in data:
        return {'ok': False, 'error': format_graph_error(data['error'])}

    vid = data.get('id')
    if not vid:
        return {'ok': False, 'error': 'Video upload succeeded but no video id returned', 'raw_response': data}
    return {'ok': True, 'video_id': str(vid), 'id': str(vid), 'name': final_name}


from .creative_mutations import create_ad_creative, update_ad_creative  # noqa: E402


# Backward-compatible alias for publish wizard
def create_link_creative(
    access_token: str,
    *,
    account_id: str,
    page_id: str,
    link_url: str,
    name: Optional[str] = None,
    message: Optional[str] = None,
    headline: Optional[str] = None,
    description: Optional[str] = None,
    picture_url: Optional[str] = None,
    call_to_action_type: str = 'LEARN_MORE',
    api_version: str = 'v22.0',
) -> Dict[str, Any]:
    return create_ad_creative(
        access_token,
        account_id=account_id,
        page_id=page_id,
        link_url=link_url,
        name=name,
        message=message,
        headline=headline,
        description=description,
        picture_url=picture_url,
        call_to_action_type=call_to_action_type,
        api_version=api_version,
    )
