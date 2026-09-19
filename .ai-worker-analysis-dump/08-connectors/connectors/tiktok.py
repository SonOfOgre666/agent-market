"""TikTok Content API — execution-only; OAuth in apps/api."""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Dict

import httpx

from connectors._social_content import extract_text_link_media
from connectors._social_media import partition_post_media, primary_thumbnail, primary_video
from connectors._tiktok_video import (
    TIKTOK_TITLE_MAX,
    friendly_tiktok_fail_reason,
    inject_cover_image,
    prepare_video_for_tiktok,
)
from connectors.social_types import SocialPublishOutcome

logger = logging.getLogger(__name__)

CREATOR_INFO_URL = 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/'
PUBLISH_INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/video/init/'
PUBLISH_STATUS_URL = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/'


def _tiktok_error_details(body: str) -> tuple[str, str]:
    """Return (code, message) from a TikTok API error JSON body."""
    try:
        raw = json.loads(body)
        err = raw.get('error')
        if isinstance(err, dict):
            return (
                str(err.get('code') or '').strip(),
                str(err.get('message') or '').strip(),
            )
    except Exception:
        pass
    return ('', '')


def _outcome_from_tiktok_http_error(err: httpx.HTTPStatusError) -> SocialPublishOutcome:
    msg = str(err)
    body = ''
    try:
        if err.response is not None:
            body = err.response.text[:500]
    except Exception:
        pass
    code, api_message = _tiktok_error_details(body)
    if api_message:
        msg = api_message
    elif code:
        msg = friendly_tiktok_fail_reason(code)
    elif body:
        msg = body
    logger.warning('[connector.tiktok] HTTP %s', body or msg)
    if err.response is not None and err.response.status_code == 401:
        return SocialPublishOutcome(ok=False, error=msg, account_deauthorized=True)
    return SocialPublishOutcome(ok=False, error=msg)


def publish_post(*, account: dict, version: dict, _cfg: Dict[str, Any]) -> SocialPublishOutcome:
    """Direct post (``FILE_UPLOAD``) using video bytes downloaded from the media URL."""
    if str(account.get('provider') or '') != 'tiktok':
        return SocialPublishOutcome(ok=False, error='TikTok connector: wrong account provider')
    token = (account.get('access_token') or {}).get('token')
    if not token:
        return SocialPublishOutcome(ok=False, error='Missing TikTok access token')

    title, _link, _ = extract_text_link_media(version)
    parts = partition_post_media(version)
    video = primary_video(parts)
    thumb = primary_thumbnail(parts)
    url = (video or {}).get('url')
    if not url:
        return SocialPublishOutcome(ok=False, error='TikTok requires a video attachment')

    headers_json = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json; charset=UTF-8'}

    try:
        vr = httpx.get(url, timeout=300.0, follow_redirects=True)
        vr.raise_for_status()
        video_bytes = vr.content
        prep = prepare_video_for_tiktok(video_bytes)
        if not prep.ok:
            return SocialPublishOutcome(ok=False, error=prep.error or 'TikTok video preparation failed')
        video_bytes = prep.video_bytes
        if thumb and thumb.get('url'):
            try:
                tr = httpx.get(thumb['url'], timeout=120.0, follow_redirects=True)
                tr.raise_for_status()
                video_bytes, _injected = inject_cover_image(video_bytes, tr.content)
            except Exception as exc:
                logger.warning('[connector.tiktok] cover image download/inject failed: %s', exc)
        video_size = len(video_bytes)
        if video_size < 1:
            return SocialPublishOutcome(ok=False, error='TikTok: empty video download')

        privacy_level = 'SELF_ONLY'
        try:
            cr = httpx.post(CREATOR_INFO_URL, json={}, headers=headers_json, timeout=60.0)
            cr.raise_for_status()
            opts = (cr.json() or {}).get('data', {}).get('privacy_level_options') or []
            if 'SELF_ONLY' in opts:
                privacy_level = 'SELF_ONLY'
            elif opts:
                privacy_level = str(opts[0])
        except Exception as exc:
            logger.warning('[connector.tiktok] creator_info: %s', exc)

        post_info: dict[str, Any] = {
            'title': (title or '')[:TIKTOK_TITLE_MAX],
            'privacy_level': privacy_level,
            'disable_duet': False,
            'disable_comment': False,
            'disable_stitch': False,
        }
        init_body = {
            'post_info': post_info,
            'source_info': {
                'source': 'FILE_UPLOAD',
                'video_size': video_size,
                'chunk_size': video_size,
                'total_chunk_count': 1,
            },
        }
        ir = httpx.post(PUBLISH_INIT_URL, json=init_body, headers=headers_json, timeout=120.0)
        ir.raise_for_status()
        idata = ir.json() or {}
        err = idata.get('error') or {}
        if isinstance(err, dict):
            code = err.get('code')
            if code is not None and str(code).lower() != 'ok':
                return SocialPublishOutcome(
                    ok=False,
                    error=f"TikTok init: {err.get('message', err)}",
                )
        data = idata.get('data') or {}
        publish_id = data.get('publish_id')
        upload_url = data.get('upload_url')
        if not publish_id or not upload_url:
            return SocialPublishOutcome(ok=False, error=f'TikTok init missing fields: {json.dumps(idata)[:500]}')

        up = httpx.put(
            upload_url,
            content=video_bytes,
            headers={
                'Content-Type': 'video/mp4',
                'Content-Range': f'bytes 0-{video_size - 1}/{video_size}',
                'Content-Length': str(video_size),
            },
            timeout=300.0,
        )
        up.raise_for_status()

        post_id = _poll_publish_status(publish_id, token)
        return SocialPublishOutcome(ok=True, provider_post_id=post_id, upsert_data={'provider_post_id': post_id})
    except httpx.HTTPStatusError as err:
        return _outcome_from_tiktok_http_error(err)
    except Exception as exc:
        logger.warning('[connector.tiktok] publish: %s', exc)
        return SocialPublishOutcome(ok=False, error=str(exc))


def _poll_publish_status(publish_id: str, token: str, retries: int = 24) -> str:
    headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json; charset=UTF-8'}
    for _ in range(retries):
        time.sleep(3.0)
        res = httpx.post(PUBLISH_STATUS_URL, json={'publish_id': publish_id}, headers=headers, timeout=60.0)
        res.raise_for_status()
        raw = res.json() or {}
        err = raw.get('error') or {}
        if isinstance(err, dict):
            code = err.get('code')
            if code is not None and str(code).lower() != 'ok':
                raise RuntimeError(str(err))
        st = (raw.get('data') or {}).get('status')
        if st in ('PUBLISH_COMPLETE', 'SEND_TO_USER_INBOX'):
            ids = (raw.get('data') or {}).get('publicaly_available_post_id') or []
            return str(ids[0]) if ids else str(publish_id)
        if st == 'FAILED':
            reason = (raw.get('data') or {}).get('fail_reason') or 'TikTok publish failed'
            raise RuntimeError(friendly_tiktok_fail_reason(str(reason)))
    raise RuntimeError('TikTok publish timed out')


def upload_media(*_args: Any, **_kwargs: Any) -> Dict[str, Any]:
    return {'ok': False, 'error': 'Standalone upload_media is not used — media uploads happen inside publish_post.'}


def fetch_post_metrics(*_args: Any, **_kwargs: Any) -> Dict[str, Any]:
    return {
        'ok': False,
        'error': 'TikTok post metrics require the TikTok Business API video query endpoint — not configured on this account.',
    }
