"""LinkedIn execution-only API (UGC publish). OAuth lives in apps/api."""

from __future__ import annotations

import logging
from typing import Any, Dict, List

import httpx

from connectors._ratelimit import parse_retry_after, rate_ttl, store_rate
from connectors._social_content import account_id_str, extract_text_link_media
from connectors._social_media import partition_post_media, primary_thumbnail, primary_video
from connectors import linkedin_media
from connectors.social_types import SocialPublishOutcome

logger = logging.getLogger(__name__)


def _author_urn(account: dict) -> str:
    pid = str(account.get('provider_id') or '').strip()
    org_id = (account.get('data') or {}).get('organization_id')
    if org_id:
        return f'urn:li:organization:{org_id}'
    return f'urn:li:person:{pid}'


def publish_post(
    *,
    r: Any,
    post: dict,
    account: dict,
    version: dict,
    _li_cfg: Dict[str, Any],
) -> SocialPublishOutcome:
    """Publish one LinkedIn post — text, link, images (up to 9), or video."""
    account_id = account_id_str(account)
    ttl = rate_ttl(r, 'linkedin', account_id)
    if ttl:
        return SocialPublishOutcome(ok=False, error=f'Rate limited — retry in {ttl}s')

    token = (account.get('access_token') or {}).get('token')
    if not token or not account.get('provider_id'):
        return SocialPublishOutcome(ok=False, error='LinkedIn token or provider_id missing')

    text, link_url, _ = extract_text_link_media(version)
    parts = partition_post_media(version)
    video = primary_video(parts)
    images = parts['images']
    thumb = primary_thumbnail(parts)

    if video and images:
        return SocialPublishOutcome(
            ok=False,
            error='LinkedIn does not support image and video in the same post',
        )

    author = _author_urn(account)

    try:
        video_asset = None
        image_assets: list[str] = []

        if video:
            url = (video.get('url') or '').strip()
            if not url:
                return SocialPublishOutcome(ok=False, error='LinkedIn video URL is missing')
            thumb_url = (thumb.get('url') or '').strip() if thumb else ''
            video_asset = linkedin_media.upload_video_asset(
                token,
                author,
                url,
                thumbnail_url=thumb_url or None,
            )
        elif images:
            for item in images[:9]:
                url = (item.get('url') or '').strip()
                if not url:
                    continue
                image_assets.append(linkedin_media.upload_image_asset(token, author, url))
            if not image_assets:
                return SocialPublishOutcome(ok=False, error='LinkedIn image URL is missing')

        if video_asset and str(video_asset).startswith('urn:li:video:'):
            body = linkedin_media.build_rest_video_post_body(
                author_urn=author,
                text=text or '',
                video_urn=video_asset,
            )
            post_id = linkedin_media.create_rest_post(token, body)
        else:
            body = linkedin_media.build_ugc_body(
                author_urn=author,
                text=text or '',
                link_url=link_url if not video_asset and not image_assets else None,
                image_assets=image_assets,
                video_asset=video_asset,
            )
            post_id = linkedin_media.create_ugc_post(token, body)
        return SocialPublishOutcome(
            ok=True,
            provider_post_id=post_id,
            upsert_data={'id': post_id, 'provider_post_id': post_id},
        )
    except httpx.HTTPStatusError as err:
        msg = str(err)
        try:
            if err.response is not None and err.response.content:
                payload = err.response.json()
                if isinstance(payload, dict):
                    msg = str(payload.get('message') or payload.get('error') or msg)
        except Exception:
            pass
        if err.response is not None and err.response.status_code == 429:
            retry_sec = parse_retry_after(dict(err.response.headers))
            store_rate(r, 'linkedin', account_id, retry_sec)
            return SocialPublishOutcome(
                ok=False,
                error='LinkedIn rate limited (429)',
                rate_limit_seconds=retry_sec,
            )
        if err.response is not None and err.response.status_code in (401, 403):
            return SocialPublishOutcome(
                ok=False,
                error=f'LinkedIn auth error {err.response.status_code}',
                account_deauthorized=True,
            )
        if len(msg) > 400:
            msg = msg[:400].rstrip() + '…'
        logger.warning('[connector.linkedin] publish HTTP %s: %s', err.response.status_code if err.response else '?', msg)
        return SocialPublishOutcome(ok=False, error=msg)
    except Exception as exc:
        logger.warning('[connector.linkedin] publish: %s', exc)
        return SocialPublishOutcome(ok=False, error=str(exc))


def upload_media(*_args: Any, **_kwargs: Any) -> Dict[str, Any]:
    return {'ok': False, 'error': 'Standalone upload_media is not used — media uploads happen inside publish_post.'}


def fetch_post_metrics(
    *,
    access_token: str,
    provider_post_id: str,
    **_kwargs: Any,
) -> Dict[str, Any]:
    """Fetch LinkedIn share statistics when provider_post_id is a share URN."""
    if not access_token or not provider_post_id:
        return {'ok': False, 'error': 'access_token and provider_post_id are required'}
    share_urn = str(provider_post_id)
    if not share_urn.startswith('urn:li:share:'):
        share_urn = f'urn:li:share:{share_urn}'
    encoded = share_urn.replace(':', '%3A')
    url = f'https://api.linkedin.com/v2/socialActions/{encoded}'
    headers = {'Authorization': f'Bearer {access_token}', 'X-Restli-Protocol-Version': '2.0.0'}
    try:
        r = httpx.get(url, headers=headers, timeout=60.0)
        r.raise_for_status()
        data = r.json() if r.content else {}
        likes = ((data.get('likesSummary') or {}).get('totalLikes'))
        comments = ((data.get('commentsSummary') or {}).get('totalFirstLevelComments'))
        return {
            'ok': True,
            'provider_post_id': provider_post_id,
            'metrics': {
                'likes': likes,
                'comments': comments,
            },
        }
    except httpx.HTTPStatusError as err:
        sc = err.response.status_code if err.response else 0
        if sc in (401, 403):
            return {'ok': False, 'error': 'LinkedIn unauthorized', 'unauthorized': True}
        if sc == 429:
            return {'ok': False, 'error': 'LinkedIn rate limited', 'rate_limited': True}
        return {'ok': False, 'error': str(err)}
    except Exception as exc:
        return {'ok': False, 'error': str(exc)}


def _linkedin_comment_urns(provider_post_id: str) -> List[str]:
    """Try UGC and share URNs — publish returns ugcPost id from REST headers."""
    raw = str(provider_post_id or '').strip()
    if not raw:
        return []
    if raw.startswith('urn:li:'):
        return [raw]
    return [f'urn:li:ugcPost:{raw}', f'urn:li:share:{raw}']


def _linkedin_rest_headers(token: str) -> Dict[str, str]:
    return {
        'Authorization': f'Bearer {token}',
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': '202606',
    }


def fetch_comments(
    *,
    access_token: str,
    provider_post_id: str,
    account: dict,
    limit: int = 50,
) -> Dict[str, Any]:
    """Fetch first-level comments on a LinkedIn share/UGC post."""
    token = str(access_token or '').strip()
    if not token:
        return {'ok': False, 'error': 'Missing LinkedIn access token', 'comments': []}

    comments: List[Dict[str, Any]] = []
    last_error = 'LinkedIn comments not available'

    for urn in _linkedin_comment_urns(provider_post_id):
        encoded = urn.replace(':', '%3A')
        url = f'https://api.linkedin.com/rest/socialActions/{encoded}/comments'
        start = 0
        try:
            while len(comments) < limit:
                r = httpx.get(
                    url,
                    headers=_linkedin_rest_headers(token),
                    params={'start': start, 'count': min(50, limit - len(comments))},
                    timeout=60.0,
                )
                if r.status_code in (401, 403):
                    return {
                        'ok': False,
                        'error': (
                            'LinkedIn comment read denied — reconnect after your LinkedIn app is approved '
                            'for Community Management API (r_member_social_feed scope)'
                        ),
                        'oauth_invalid': True,
                        'comments': [],
                    }
                if r.status_code == 404:
                    last_error = f'LinkedIn post not found: {urn}'
                    break
                r.raise_for_status()
                data = r.json() if r.content else {}
                elements = data.get('elements') or []
                if not elements:
                    break
                for el in elements:
                    if not isinstance(el, dict):
                        continue
                    cid = str(el.get('$URN') or el.get('urn') or el.get('id') or '').strip()
                    msg = el.get('message') or {}
                    text = str((msg.get('text') if isinstance(msg, dict) else msg) or '').strip()
                    if not cid or not text:
                        continue
                    actor = el.get('actor') or el.get('created', {}).get('actor') if isinstance(el.get('created'), dict) else None
                    created = el.get('created', {}).get('time') if isinstance(el.get('created'), dict) else el.get('createdAt')
                    comments.append({
                        'provider_comment_id': cid,
                        'comment': text,
                        'author': str(actor).split(':')[-1] if actor else None,
                        'platform_created_at': created,
                    })
                paging = data.get('paging') or {}
                start = int(paging.get('start', 0)) + len(elements)
                total = paging.get('total')
                if total is not None and start >= int(total):
                    break
                if len(elements) < 1:
                    break
            if comments:
                return {'ok': True, 'comments': comments[:limit], 'provider': 'linkedin'}
        except httpx.HTTPStatusError as err:
            sc = err.response.status_code if err.response else 0
            if sc in (401, 403):
                return {'ok': False, 'error': 'LinkedIn unauthorized', 'oauth_invalid': True, 'comments': []}
            if sc == 429:
                return {'ok': False, 'error': 'LinkedIn rate limited', 'rate_limited': True, 'comments': []}
            last_error = str(err)
        except Exception as exc:
            last_error = str(exc)

    return {'ok': False, 'error': last_error, 'comments': []}


def reply_to_comment(
    *,
    access_token: str,
    provider_comment_id: str,
    message: str,
    account: dict,
) -> Dict[str, Any]:
    """Reply to a LinkedIn comment."""
    token = str(access_token or '').strip()
    text = str(message or '').strip()
    cid = str(provider_comment_id or '').strip()
    if not token or not text or not cid:
        return {'ok': False, 'error': 'Missing token, comment id, or message'}

    comment_urn = cid if cid.startswith('urn:li:') else f'urn:li:comment:{cid}'
    encoded = comment_urn.replace(':', '%3A')
    url = f'https://api.linkedin.com/rest/socialActions/{encoded}/comments'
    author = _author_urn(account)
    body = {
        'actor': author,
        'message': {'text': text},
    }
    try:
        r = httpx.post(url, headers=_linkedin_rest_headers(token), json=body, timeout=60.0)
        if r.status_code in (401, 403):
            return {'ok': False, 'error': 'LinkedIn unauthorized', 'oauth_invalid': True}
        if r.status_code == 429:
            return {'ok': False, 'error': 'LinkedIn rate limited', 'rate_limited': True}
        r.raise_for_status()
        reply_id = r.headers.get('x-restli-id') or ''
        return {'ok': True, 'provider_reply_id': str(reply_id) if reply_id else None}
    except httpx.HTTPStatusError as err:
        return {'ok': False, 'error': str(err)}
    except Exception as exc:
        return {'ok': False, 'error': str(exc)}
