"""Facebook Pages (Meta Graph) — execution-only reads/writes; API owns OAuth."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List

import httpx

from connectors._meta_graph import (
    graph_error_meta,
    graph_get,
    is_graph_oauth_invalid,
    is_graph_rate_limited,
)
from connectors._social_content import extract_text_link_media
from connectors._social_media import partition_post_media, primary_thumbnail, primary_video
from connectors._video_cover import (
    facebook_apply_injected_cover_thumbnail,
    prepare_facebook_video_bytes,
)
from connectors.social_types import SocialPublishOutcome

logger = logging.getLogger(__name__)


def _fb_ver(cfg: Dict[str, Any]) -> str:
    v = str((cfg or {}).get('api_version') or 'v25.0').strip()
    return v if v.startswith('v') else f'v{v}'


def _fb_root(cfg: Dict[str, Any]) -> str:
    return f'https://graph.facebook.com/{_fb_ver(cfg)}'


def publish_post(*, account: dict, version: dict, fb_cfg: Dict[str, Any]) -> SocialPublishOutcome:
    """
    Publish to a Facebook **Page** (``facebook`` / ``facebook_page`` accounts).
    Uses page access token on ``…/{page-id}/feed|photos|videos``.
    """
    prov = str(account.get('provider') or '')
    if prov not in ('facebook', 'facebook_page'):
        return SocialPublishOutcome(ok=False, error=f'Unsupported provider for Facebook connector: {prov}')
    token = (account.get('access_token') or {}).get('token')
    page_id = str(account.get('provider_id') or '')
    if not token or not page_id:
        return SocialPublishOutcome(ok=False, error='Missing page access token or provider_id')

    text, link_url, _ = extract_text_link_media(version)
    parts = partition_post_media(version)
    video = primary_video(parts)
    thumb = primary_thumbnail(parts)
    images = parts['images']

    root = _fb_root(fb_cfg)

    def post_path(suffix: str, data: Dict[str, Any]) -> httpx.Response:
        url = f'{root}/{suffix.lstrip("/")}'
        return httpx.post(url, data=data, timeout=120.0)

    try:
        if video:
            video_url = str(video.get('url') or '').strip()
            if not video_url:
                return SocialPublishOutcome(ok=False, error='Facebook video publish missing url')

            upload_bytes, thumb_jpeg, cover_bytes, cover_injected = (
                prepare_facebook_video_bytes(video, thumb)
                if thumb and thumb.get('url')
                else (None, None, None, False)
            )
            payload: Dict[str, Any] = {
                'description': text or '',
                'access_token': token,
            }
            if upload_bytes:
                files: Dict[str, Any] = {
                    'source': ('video.mp4', upload_bytes, 'video/mp4'),
                }
                if thumb_jpeg:
                    files['thumb'] = ('cover.jpg', thumb_jpeg, 'image/jpeg')
                r = httpx.post(
                    f'{root}/{page_id}/videos',
                    data=payload,
                    files=files,
                    timeout=300.0,
                )
            else:
                payload['file_url'] = video_url
                r = post_path(f'{page_id}/videos', payload)
            r.raise_for_status()
            body = r.json() or {}
            pid = str(body.get('video_id') or body.get('id') or '')
            if not pid:
                return SocialPublishOutcome(ok=False, error='Facebook video publish returned no id')
            if thumb and thumb.get('url') and not cover_injected:
                logger.warning(
                    '[connector.facebook] video published without cover inject video=%s',
                    pid,
                )
            elif cover_injected and upload_bytes and cover_bytes:
                cover_ok = facebook_apply_injected_cover_thumbnail(
                    video_id=pid,
                    cover_bytes=cover_bytes,
                    thumb_jpeg=thumb_jpeg,
                    upload_bytes=upload_bytes,
                    access_token=token,
                    graph_root=root,
                    video_item=video,
                )
                if not cover_ok:
                    logger.warning(
                        '[connector.facebook] video published but preferred cover thumbnail was not set video=%s',
                        pid,
                    )
            return SocialPublishOutcome(ok=True, provider_post_id=pid, upsert_data={'provider_post_id': pid})

        if not images and not link_url:
            payload: Dict[str, Any] = {'message': text or '', 'access_token': token}
            if link_url:
                payload['link'] = link_url
            r = post_path(f'{page_id}/feed', payload)
            r.raise_for_status()
            pid = str((r.json() or {}).get('id') or '')
            if not pid:
                return SocialPublishOutcome(ok=False, error='Facebook feed publish returned no id')
            return SocialPublishOutcome(ok=True, provider_post_id=pid, upsert_data={'provider_post_id': pid})

        if len(images) == 1 and (
            str(images[0].get('mime_type') or '').lower() == 'image/gif'
        ):
            m0 = images[0]
            payload = {'message': text or '', 'url': m0.get('url') or '', 'access_token': token}
            if link_url:
                payload['link'] = link_url
            r = post_path(f'{page_id}/photos', payload)
            r.raise_for_status()
            pid = str((r.json() or {}).get('id') or '')
            if not pid:
                return SocialPublishOutcome(ok=False, error='Facebook photo publish returned no id')
            return SocialPublishOutcome(ok=True, provider_post_id=pid, upsert_data={'provider_post_id': pid})

        if len(images) == 1:
            m0 = images[0]
            payload = {'message': text or '', 'url': m0.get('url') or '', 'access_token': token}
            if link_url:
                payload['link'] = link_url
            r = post_path(f'{page_id}/photos', payload)
            r.raise_for_status()
            pid = str((r.json() or {}).get('id') or '')
            if not pid:
                return SocialPublishOutcome(ok=False, error='Facebook photo publish returned no id')
            return SocialPublishOutcome(ok=True, provider_post_id=pid, upsert_data={'provider_post_id': pid})

        photo_ids: List[Dict[str, str]] = []
        for m in images:
            r = post_path(
                f'{page_id}/photos',
                {
                    'url': m.get('url') or '',
                    'published': 'false',
                    'access_token': token,
                },
            )
            r.raise_for_status()
            mid = str((r.json() or {}).get('id') or '')
            if mid:
                photo_ids.append({'media_fbid': mid})
        if not photo_ids:
            return SocialPublishOutcome(ok=False, error='Facebook multi-photo upload failed')
        payload = {
            'message': text or '',
            'attached_media': json.dumps(photo_ids),
            'access_token': token,
        }
        if link_url:
            payload['link'] = link_url
        r = post_path(f'{page_id}/feed', payload)
        r.raise_for_status()
        pid = str((r.json() or {}).get('id') or '')
        if not pid:
            return SocialPublishOutcome(ok=False, error='Facebook carousel feed returned no id')
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
            return SocialPublishOutcome(ok=False, error='Facebook rate limited', rate_limit_seconds=60)
        if is_graph_oauth_invalid(meta) or (isinstance(body, dict) and _fb_deauth(body)):
            return SocialPublishOutcome(ok=False, error='Facebook unauthorized', account_deauthorized=True)
        msg = str(err)
        if isinstance(body.get('error'), dict) and body['error'].get('message'):
            msg = str(body['error']['message'])
        logger.warning('[connector.facebook] publish HTTP %s: %s', err.response.status_code if err.response else '?', msg)
        return SocialPublishOutcome(ok=False, error=msg)
    except Exception as exc:
        logger.warning('[connector.facebook] publish: %s', exc)
        return SocialPublishOutcome(ok=False, error=str(exc))


def _fb_deauth(body: dict) -> bool:
    err = body.get('error') if isinstance(body, dict) else None
    return isinstance(err, dict) and int(err.get('code') or 0) == 190


def upload_media(*_args: Any, **_kwargs: Any) -> Dict[str, Any]:
    return {
        'ok': False,
        'error': 'Standalone upload_media is not used — media uploads happen inside publish_post.',
    }


def fetch_post_metrics(
    *,
    access_token: str,
    provider_post_id: str,
    fb_cfg: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    """Fetch basic post insights from Meta Graph API."""
    if not access_token or not provider_post_id:
        return {'ok': False, 'error': 'access_token and provider_post_id are required'}
    root = _fb_root(fb_cfg or {})
    params = {
        'metric': 'post_impressions,post_engaged_users,post_clicks',
        'access_token': access_token,
    }
    try:
        r = httpx.get(f'{root}/{provider_post_id}/insights', params=params, timeout=60.0)
        r.raise_for_status()
        data = r.json().get('data') or []
        metrics: Dict[str, Any] = {}
        for row in data:
            name = str(row.get('name') or '')
            values = row.get('values') or []
            if values:
                metrics[name] = values[-1].get('value')
        return {'ok': True, 'provider_post_id': provider_post_id, 'metrics': metrics}
    except httpx.HTTPStatusError as err:
        meta = graph_error_meta(err)
        if is_graph_rate_limited(meta):
            return {'ok': False, 'error': 'Facebook rate limited', 'rate_limited': True}
        if is_graph_oauth_invalid(meta):
            return {'ok': False, 'error': 'Facebook unauthorized', 'unauthorized': True}
        return {'ok': False, 'error': str(err)}
    except Exception as exc:
        return {'ok': False, 'error': str(exc)}


def fetch_me_accounts(
    access_token: str,
    *,
    api_version: str = 'v22.0',
    timeout: float = 60.0,
) -> Dict[str, Any]:
    """
    Graph GET ``/{version}/me/accounts`` — pages the user token can manage (picker UI).

    Returns ``{ok: True, pages: [{id, name, avatar}]}`` or ``{ok: False, error, http_status?, ...}``.
    """
    ver = (api_version or 'v22.0').strip()
    if not ver.startswith('v'):
        ver = f'v{ver}'
    url = f'https://graph.facebook.com/{ver}/me/accounts'
    params = {'access_token': access_token, 'fields': 'id,name,picture'}
    try:
        resp = httpx.get(url, params=params, timeout=timeout)
        resp.raise_for_status()
        payload = resp.json()
        rows: List[Dict[str, Any]] = list(payload.get('data') or [])
        pages = [
            {
                'id': p.get('id'),
                'name': p.get('name'),
                'avatar': (p.get('picture') or {}).get('data', {}).get('url') if isinstance(p.get('picture'), dict) else None,
            }
            for p in rows
        ]
        return {'ok': True, 'pages': pages}
    except httpx.HTTPStatusError as err:
        meta = graph_error_meta(err)
        msg = str(err)
        try:
            if err.response is not None:
                body = err.response.json()
                err_obj = body.get('error') if isinstance(body, dict) else None
                if isinstance(err_obj, dict) and err_obj.get('message'):
                    msg = str(err_obj['message'])
        except Exception:
            pass
        if is_graph_rate_limited(meta):
            return {'ok': False, 'error': msg, 'http_status': 429, 'rate_limited': True, **meta}
        if is_graph_oauth_invalid(meta):
            return {'ok': False, 'error': msg, 'http_status': 400, 'unauthorized': True, **meta}
        sc = int(meta.get('status_code') or 502)
        return {'ok': False, 'error': msg, 'http_status': sc if 400 <= sc < 600 else 502, **meta}
    except Exception as exc:
        return {'ok': False, 'error': str(exc), 'http_status': 502, 'retryable': True}


def fetch_page_follower_counts(access_token: str, page_id: str, *, timeout: float = 60.0) -> Dict[str, Any]:
    """
    Graph GET node fields ``fan_count``, ``followers_count``.

    Returns ``{ok: True, data: {...}}`` or ``{ok: False, rate_limited|unauthorized|retryable, ...}``.
    """
    params = {'fields': 'followers_count', 'access_token': access_token}
    try:
        resp = graph_get(page_id, params, timeout=timeout)
        resp.raise_for_status()
        return {'ok': True, 'data': resp.json()}
    except httpx.HTTPStatusError as err:
        if err.response is not None and err.response.status_code == 400:
            try:
                resp2 = graph_get(page_id, {'fields': 'fan_count', 'access_token': access_token}, timeout=timeout)
                resp2.raise_for_status()
                return {'ok': True, 'data': resp2.json()}
            except httpx.HTTPStatusError:
                pass
        meta = graph_error_meta(err)
        if is_graph_rate_limited(meta):
            return {'ok': False, 'rate_limited': True, **meta}
        if is_graph_oauth_invalid(meta):
            return {'ok': False, 'unauthorized': True, **meta}
        return {'ok': False, 'retryable': True, **meta, 'error': str(err)}


def fetch_page_insights_day_series(
    access_token: str,
    page_id: str,
    *,
    since: str,
    until: str,
    timeout: float = 120.0,
) -> Dict[str, Any]:
    """
    Graph ``/{page_id}/insights`` for ``page_post_engagements``, ``page_posts_impressions`` (day).

    Returns ``{ok: True, insights: [...]}`` (``insights`` is Graph ``data`` array) or error flags.
    """
    path = f'{page_id}/insights'
    params = {
        'access_token': access_token,
        'metric': 'page_post_engagements,page_posts_impressions',
        'period': 'day',
        'since': since,
        'until': until,
    }
    try:
        resp = graph_get(path, params, timeout=timeout)
        resp.raise_for_status()
        payload = resp.json()
        insights: List[dict] = list(payload.get('data') or [])
        return {'ok': True, 'insights': insights}
    except httpx.HTTPStatusError as err:
        meta = graph_error_meta(err)
        if is_graph_rate_limited(meta):
            return {'ok': False, 'rate_limited': True, **meta}
        if is_graph_oauth_invalid(meta):
            return {'ok': False, 'unauthorized': True, **meta}
        return {'ok': False, 'retryable': True, **meta, 'error': str(err)}
