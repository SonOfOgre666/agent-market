"""Instagram Login API (graph.instagram.com) — publish only; OAuth in apps/api."""

from __future__ import annotations

import logging
from typing import Any, Dict, List

import httpx

from connectors._ig_publish_common import normalize_ig_media_for_publish, validate_ig_media, wait_media_container
from connectors._meta_graph import graph_error_meta, is_graph_oauth_invalid, is_graph_rate_limited
from connectors._social_content import extract_text_link_media
from connectors._social_media import partition_post_media, primary_thumbnail, primary_video
from connectors._video_cover import instagram_cover_url
from connectors.social_types import SocialPublishOutcome

logger = logging.getLogger(__name__)

IG_ROOT = 'https://graph.instagram.com/v21.0'


def _is_video_item(item: dict) -> bool:
    mime = str(item.get('mime_type') or '').lower()
    return mime.startswith('video/') or str(item.get('role') or '').lower() == 'video'


def publish_post(*, account: dict, version: dict, _fb_cfg: Dict[str, Any]) -> SocialPublishOutcome:
    """Publish for ``instagram_login`` accounts (Instagram Login product, Graph ``graph.instagram.com``)."""
    if str(account.get('provider') or '') != 'instagram_login':
        return SocialPublishOutcome(ok=False, error='instagram_login connector: wrong account provider')
    token = (account.get('access_token') or {}).get('token')
    ig_id = str(account.get('provider_id') or '')
    if not token or not ig_id:
        return SocialPublishOutcome(ok=False, error='Missing Instagram token or provider_id')

    text, _link, _ = extract_text_link_media(version)
    parts = partition_post_media(version)
    video = primary_video(parts)
    thumb = primary_thumbnail(parts)
    images = normalize_ig_media_for_publish(parts['images'])
    if not video and not images:
        return SocialPublishOutcome(ok=False, error='Instagram requires at least one media item')
    try:
        validate_ig_media([*( [video] if video else [] ), *images])
    except ValueError as exc:
        return SocialPublishOutcome(ok=False, error=str(exc))

    root = IG_ROOT.rstrip('/')
    is_story = bool(version.get('is_story'))

    def post_media(data: Dict[str, Any]) -> str:
        r = httpx.post(f'{root}/{ig_id}/media', data=data, timeout=120.0)
        r.raise_for_status()
        cid = str((r.json() or {}).get('id') or '')
        if not cid:
            raise RuntimeError('Instagram media container returned no id')
        wait_media_container(session=root, container_id=cid, token=token)
        return cid

    try:
        if is_story:
            item = video or (images[0] if images else None)
            if not item:
                return SocialPublishOutcome(ok=False, error='Instagram story requires media')
            is_video = _is_video_item(item)
            field = 'video_url' if is_video else 'image_url'
            cid = post_media({field: item.get('url') or '', 'media_type': 'STORIES', 'access_token': token})
        elif video:
            payload: Dict[str, Any] = {
                'video_url': video.get('url') or '',
                'caption': text or '',
                'media_type': 'REELS',
                'access_token': token,
            }
            if thumb and thumb.get('url'):
                cover = instagram_cover_url(thumb)
                if cover:
                    payload['cover_url'] = cover
            cid = post_media(payload)
        elif len(images) == 1:
            m0 = images[0]
            cid = post_media(
                {
                    'image_url': m0.get('url') or '',
                    'caption': text or '',
                    'media_type': 'IMAGE',
                    'access_token': token,
                }
            )
        else:
            item_ids: List[str] = []
            for m in images:
                mid = post_media(
                    {
                        'image_url': m.get('url') or '',
                        'is_carousel_item': 'true',
                        'media_type': 'IMAGE',
                        'access_token': token,
                    }
                )
                item_ids.append(mid)
            r = httpx.post(
                f'{root}/{ig_id}/media',
                data={
                    'media_type': 'CAROUSEL',
                    'caption': text or '',
                    'children': ','.join(item_ids),
                    'access_token': token,
                },
                timeout=120.0,
            )
            r.raise_for_status()
            cid = str((r.json() or {}).get('id') or '')
            if not cid:
                return SocialPublishOutcome(ok=False, error='Instagram carousel container failed')
            wait_media_container(session=root, container_id=cid, token=token)

        pr = httpx.post(
            f'{root}/{ig_id}/media_publish',
            data={'creation_id': cid, 'access_token': token},
            timeout=120.0,
        )
        pr.raise_for_status()
        pid = str((pr.json() or {}).get('id') or '')
        if not pid:
            return SocialPublishOutcome(ok=False, error='Instagram media_publish returned no id')
        return SocialPublishOutcome(ok=True, provider_post_id=pid, upsert_data={'provider_post_id': pid})
    except httpx.HTTPStatusError as err:
        body: Dict[str, Any] = {}
        try:
            if err.response is not None:
                body = err.response.json() if err.response.content else {}
        except Exception:
            body = {}
        meta = graph_error_meta(err)
        if is_graph_rate_limited(meta):
            return SocialPublishOutcome(ok=False, error='Instagram rate limited', rate_limit_seconds=60)
        if is_graph_oauth_invalid(meta) or (
            isinstance(body.get('error'), dict) and int(body['error'].get('code') or 0) == 190
        ):
            return SocialPublishOutcome(ok=False, error='Instagram unauthorized', account_deauthorized=True)
        msg = str(err)
        if isinstance(body.get('error'), dict) and body['error'].get('message'):
            msg = str(body['error']['message'])
        logger.warning('[connector.instagram_login] publish HTTP %s: %s', err.response.status_code if err.response else '?', msg)
        return SocialPublishOutcome(ok=False, error=msg)
    except Exception as exc:
        logger.warning('[connector.instagram_login] publish: %s', exc)
        return SocialPublishOutcome(ok=False, error=str(exc))
