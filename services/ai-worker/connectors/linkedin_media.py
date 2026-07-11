"""LinkedIn Assets API — register upload + binary upload for UGC posts."""

from __future__ import annotations

import logging
import os
import time
from typing import Any
from urllib.parse import quote

import httpx

logger = logging.getLogger(__name__)

_RECIPE_IMAGE = 'urn:li:digitalmediaRecipe:feedshare-image'
_RECIPE_VIDEO = 'urn:li:digitalmediaRecipe:feedshare-video'
_ASSETS_URL = 'https://api.linkedin.com/v2/assets'
_UGC_URL = 'https://api.linkedin.com/v2/ugcPosts'
_VIDEOS_INIT_URL = 'https://api.linkedin.com/rest/videos?action=initializeUpload'
_VIDEOS_FINALIZE_URL = 'https://api.linkedin.com/rest/videos?action=finalizeUpload'
_LINKEDIN_API_VERSION = os.environ.get('LINKEDIN_API_VERSION', '202502')


def _headers(token: str) -> dict[str, str]:
    return {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
    }


def _rest_headers(token: str) -> dict[str, str]:
    return {
        **_headers(token),
        'Linkedin-Version': _LINKEDIN_API_VERSION,
    }


def _download_media(url: str) -> tuple[bytes, str]:
    resp = httpx.get(url, timeout=300.0, follow_redirects=True)
    resp.raise_for_status()
    mime = (resp.headers.get('content-type') or 'application/octet-stream').split(';')[0].strip().lower()
    return resp.content, mime


def _content_type_for_upload(mime: str, *, video: bool) -> str:
    if video:
        if 'quicktime' in mime:
            return 'video/quicktime'
        return 'video/mp4'
    if 'png' in mime:
        return 'image/png'
    if 'gif' in mime:
        return 'image/gif'
    return 'image/jpeg'


def _register_upload(token: str, owner_urn: str, recipe: str) -> tuple[str, str]:
    resp = httpx.post(
        f'{_ASSETS_URL}?action=registerUpload',
        json={
            'registerUploadRequest': {
                'recipes': [recipe],
                'owner': owner_urn,
                'serviceRelationships': [
                    {
                        'relationshipType': 'OWNER',
                        'identifier': 'urn:li:userGeneratedContent',
                    },
                ],
            },
        },
        headers=_headers(token),
        timeout=60.0,
    )
    resp.raise_for_status()
    value = (resp.json() or {}).get('value') or {}
    asset = str(value.get('asset') or '').strip()
    upload_mechanism = value.get('uploadMechanism') or {}
    http_req = upload_mechanism.get('com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest') or {}
    upload_url = str(http_req.get('uploadUrl') or '').strip()
    if not asset or not upload_url:
        raise RuntimeError('LinkedIn registerUpload did not return asset and uploadUrl')
    return asset, upload_url


def _put_binary(token: str, upload_url: str, data: bytes, content_type: str) -> None:
    resp = httpx.put(
        upload_url,
        content=data,
        headers={
            'Authorization': f'Bearer {token}',
            'Content-Type': content_type,
        },
        timeout=300.0,
    )
    resp.raise_for_status()


def _wait_asset_ready(token: str, asset_urn: str, *, timeout: float = 180.0) -> None:
    encoded = quote(asset_urn, safe='')
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        resp = httpx.get(
            f'{_ASSETS_URL}/{encoded}',
            params={'fields': 'recipes,status'},
            headers=_headers(token),
            timeout=60.0,
        )
        if resp.status_code >= 400:
            time.sleep(3.0)
            continue
        body = resp.json() or {}
        recipes = body.get('recipes') or []
        ready = any(
            isinstance(row, dict) and str(row.get('status') or '').endswith('AVAILABLE')
            for row in recipes
        )
        if ready or str(body.get('status') or '').endswith('AVAILABLE'):
            return
        time.sleep(3.0)
    logger.warning('[connector.linkedin] asset not confirmed ready — posting anyway: %s', asset_urn)


def upload_image_asset(token: str, owner_urn: str, media_url: str) -> str:
    data, mime = _download_media(media_url)
    asset, upload_url = _register_upload(token, owner_urn, _RECIPE_IMAGE)
    _put_binary(token, upload_url, data, _content_type_for_upload(mime, video=False))
    return asset


def upload_video_asset(
    token: str,
    owner_urn: str,
    media_url: str,
    *,
    thumbnail_url: str | None = None,
) -> str:
    if thumbnail_url:
        return _upload_video_via_videos_api(token, owner_urn, media_url, thumbnail_url)
    data, mime = _download_media(media_url)
    asset, upload_url = _register_upload(token, owner_urn, _RECIPE_VIDEO)
    _put_binary(token, upload_url, data, _content_type_for_upload(mime, video=True))
    _wait_asset_ready(token, asset)
    return asset


def _upload_video_via_videos_api(
    token: str,
    owner_urn: str,
    media_url: str,
    thumbnail_url: str,
) -> str:
    """Videos API — supports custom thumbnail. See Microsoft Videos API docs."""
    video_bytes, _video_mime = _download_media(media_url)
    thumb_bytes, _thumb_mime = _download_media(thumbnail_url)
    file_size = len(video_bytes)

    init_resp = httpx.post(
        _VIDEOS_INIT_URL,
        json={
            'initializeUploadRequest': {
                'owner': owner_urn,
                'fileSizeBytes': file_size,
                'uploadCaptions': False,
                'uploadThumbnail': True,
            },
        },
        headers=_rest_headers(token),
        timeout=60.0,
    )
    init_resp.raise_for_status()
    value = (init_resp.json() or {}).get('value') or {}
    video_urn = str(value.get('video') or '').strip()
    upload_token = str(value.get('uploadToken') or '')
    instructions = value.get('uploadInstructions') or []
    thumbnail_upload_url = str(value.get('thumbnailUploadUrl') or '').strip()
    if not video_urn or not instructions:
        raise RuntimeError('LinkedIn Videos API initializeUpload missing video or upload instructions')

    part_ids: list[str] = []
    for instr in instructions:
        first_byte = int(instr.get('firstByte', 0))
        last_byte = int(instr.get('lastByte', file_size - 1))
        chunk = video_bytes[first_byte:last_byte + 1]
        upload_url = str(instr.get('uploadUrl') or '').strip()
        if not upload_url:
            raise RuntimeError('LinkedIn Videos API missing uploadUrl on instruction')
        put_resp = httpx.put(
            upload_url,
            content=chunk,
            headers={'Content-Type': 'application/octet-stream'},
            timeout=300.0,
        )
        put_resp.raise_for_status()
        etag = put_resp.headers.get('etag') or put_resp.headers.get('ETag') or ''
        etag = str(etag).strip().strip('"')
        if etag:
            part_ids.append(etag)

    if thumbnail_upload_url:
        thumb_resp = httpx.put(
            thumbnail_upload_url,
            content=thumb_bytes,
            headers={
                'Content-Type': 'application/octet-stream',
                'media-type-family': 'STILLIMAGE',
            },
            timeout=120.0,
        )
        thumb_resp.raise_for_status()
    else:
        logger.warning('[connector.linkedin] Videos API init missing thumbnailUploadUrl')

    fin_resp = httpx.post(
        _VIDEOS_FINALIZE_URL,
        json={
            'finalizeUploadRequest': {
                'video': video_urn,
                'uploadToken': upload_token,
                'uploadedPartIds': part_ids,
            },
        },
        headers=_rest_headers(token),
        timeout=120.0,
    )
    fin_resp.raise_for_status()
    _wait_video_ready(token, video_urn)
    return video_urn


def _wait_video_ready(token: str, video_urn: str, *, timeout: float = 180.0) -> None:
    encoded = quote(video_urn, safe='')
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        resp = httpx.get(
            f'https://api.linkedin.com/rest/videos/{encoded}',
            headers=_rest_headers(token),
            timeout=60.0,
        )
        if resp.status_code >= 400:
            time.sleep(3.0)
            continue
        status = str((resp.json() or {}).get('status') or '').upper()
        if status in ('AVAILABLE', 'READY', 'PUBLISHED'):
            return
        if status in ('PROCESSING_FAILED', 'FAILED'):
            raise RuntimeError(f'LinkedIn video processing failed: {video_urn}')
        time.sleep(3.0)
    logger.warning('[connector.linkedin] video not confirmed ready — posting anyway: %s', video_urn)


def build_rest_video_post_body(
    *,
    author_urn: str,
    text: str,
    video_urn: str,
) -> dict[str, Any]:
    """Posts API body for urn:li:video assets (Videos API upload path)."""
    return {
        'author': author_urn,
        'commentary': text or '',
        'visibility': 'PUBLIC',
        'distribution': {
            'feedDistribution': 'MAIN_FEED',
            'targetEntities': [],
            'thirdPartyDistributionChannels': [],
        },
        'content': {
            'media': {
                'id': video_urn,
            },
        },
        'lifecycleState': 'PUBLISHED',
        'isReshareDisabledByAuthor': False,
    }


def create_rest_post(token: str, body: dict[str, Any]) -> str:
    resp = httpx.post(
        'https://api.linkedin.com/rest/posts',
        json=body,
        headers=_rest_headers(token),
        timeout=120.0,
    )
    resp.raise_for_status()
    post_id = resp.headers.get('x-restli-id') or ''
    return str(post_id) if post_id else ''


def build_ugc_body(
    *,
    author_urn: str,
    text: str,
    link_url: str | None,
    image_assets: list[str],
    video_asset: str | None,
) -> dict[str, Any]:
    if video_asset and image_assets:
        raise ValueError('LinkedIn does not support image and video in the same post')

    if video_asset:
        specific: dict[str, Any] = {
            'com.linkedin.ugc.ShareContent': {
                'shareCommentary': {'text': text or ''},
                'shareMediaCategory': 'VIDEO',
                'media': [
                    {
                        'status': 'READY',
                        'media': video_asset,
                        'title': {'text': 'Video'},
                        'description': {'text': ''},
                    },
                ],
            },
        }
    elif image_assets:
        specific = {
            'com.linkedin.ugc.ShareContent': {
                'shareCommentary': {'text': text or ''},
                'shareMediaCategory': 'IMAGE',
                'media': [
                    {
                        'status': 'READY',
                        'media': asset,
                        'title': {'text': f'Image {idx + 1}'},
                        'description': {'text': ''},
                    }
                    for idx, asset in enumerate(image_assets[:9])
                ],
            },
        }
    elif link_url:
        specific = {
            'com.linkedin.ugc.ShareContent': {
                'shareCommentary': {'text': text or ''},
                'shareMediaCategory': 'ARTICLE',
                'media': [{'status': 'READY', 'originalUrl': link_url}],
            },
        }
    else:
        specific = {
            'com.linkedin.ugc.ShareContent': {
                'shareCommentary': {'text': text or ''},
                'shareMediaCategory': 'NONE',
            },
        }

    return {
        'author': author_urn,
        'lifecycleState': 'PUBLISHED',
        'specificContent': specific,
        'visibility': {'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'},
    }


def create_ugc_post(token: str, body: dict[str, Any]) -> str:
    resp = httpx.post(_UGC_URL, json=body, headers=_headers(token), timeout=120.0)
    resp.raise_for_status()
    post_id = resp.headers.get('x-restli-id') or ''
    return str(post_id) if post_id else ''
