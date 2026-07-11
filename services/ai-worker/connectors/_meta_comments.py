"""Meta Graph comment read/reply — shared by Facebook Page and Instagram."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import httpx

from connectors._meta_graph import graph_error_meta, is_graph_oauth_invalid, is_graph_rate_limited

logger = logging.getLogger(__name__)

COMMENT_FIELDS_FB = 'id,message,created_time,from{id,name,username}'
COMMENT_FIELDS_IG = 'id,text,timestamp,from{id,username},username'
IG_LOGIN_ROOT = 'https://graph.instagram.com/v21.0'
_IG_PROVIDERS = frozenset({'instagram', 'instagram_login'})


def _comment_fields(provider: str) -> str:
    if str(provider or '').lower() in _IG_PROVIDERS:
        return COMMENT_FIELDS_IG
    return COMMENT_FIELDS_FB


def _fb_ver(cfg: Dict[str, Any]) -> str:
    v = str((cfg or {}).get('api_version') or 'v25.0').strip()
    return v if v.startswith('v') else f'v{v}'


def _fb_root(cfg: Dict[str, Any]) -> str:
    return f'https://graph.facebook.com/{_fb_ver(cfg)}'


def _api_root(provider: str, fb_cfg: Dict[str, Any]) -> str:
    if str(provider or '').lower() == 'instagram_login':
        return IG_LOGIN_ROOT
    return _fb_root(fb_cfg)


def _graph_get(root: str, path: str, params: Dict[str, Any], *, timeout: float) -> httpx.Response:
    url = f'{root.rstrip("/")}/{path.lstrip("/")}'
    return httpx.get(url, params=params, timeout=timeout)


def _normalize_comment(row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    cid = str(row.get('id') or '').strip()
    message = str(row.get('message') or row.get('text') or '').strip()
    if not cid or not message:
        return None
    author_obj = row.get('from') if isinstance(row.get('from'), dict) else {}
    author = (
        str(author_obj.get('name') or author_obj.get('username') or row.get('username') or '').strip()
        or None
    )
    return {
        'provider_comment_id': cid,
        'comment': message,
        'author': author,
        'platform_created_at': row.get('created_time') or row.get('timestamp'),
    }


def fetch_comments(
    *,
    provider_post_id: str,
    access_token: str,
    provider: str,
    fb_cfg: Dict[str, Any],
    limit: int = 50,
) -> Dict[str, Any]:
    """Fetch top-level comments on a Meta post or IG media object."""
    pid = str(provider_post_id or '').strip()
    token = str(access_token or '').strip()
    if not pid or not token:
        return {'ok': False, 'error': 'Missing provider_post_id or access_token', 'comments': []}

    comments: List[Dict[str, Any]] = []
    root = _api_root(provider, fb_cfg)
    path = f'{pid}/comments'
    params: Dict[str, Any] = {
        'fields': _comment_fields(provider),
        'access_token': token,
        'limit': min(max(int(limit), 1), 100),
    }
    pages = 0

    try:
        while path and pages < 10:
            pages += 1
            if path.startswith('http'):
                r = httpx.get(path, timeout=60.0)
            else:
                r = _graph_get(root, path, params, timeout=60.0)
            r.raise_for_status()
            payload = r.json() or {}
            for row in payload.get('data') or []:
                if not isinstance(row, dict):
                    continue
                norm = _normalize_comment(row)
                if norm:
                    comments.append(norm)
            next_url = ((payload.get('paging') or {}).get('next')) or None
            if next_url:
                path = str(next_url)
                params = {}
            else:
                break
        if not comments and str(provider or '').lower() in _IG_PROVIDERS:
            try:
                count_r = httpx.get(
                    f'{root.rstrip("/")}/{pid}',
                    params={'fields': 'comments_count', 'access_token': token},
                    timeout=30.0,
                )
                if count_r.status_code == 200:
                    reported = int((count_r.json() or {}).get('comments_count') or 0)
                    if reported > 0:
                        return {
                            'ok': False,
                            'error': (
                                f'Instagram reports {reported} comment(s) but the API returned none. '
                                'In Development mode, only Instagram Tester accounts can read comments — '
                                'switch your Meta app to Live mode or add commenters as Testers.'
                            ),
                            'comments': [],
                            'ig_comments_unavailable': True,
                        }
            except Exception:
                pass
        return {'ok': True, 'comments': comments, 'provider': provider}
    except httpx.HTTPStatusError as exc:
        meta = graph_error_meta(exc)
        prov = str(provider or '').lower()
        if prov == 'instagram_login' and 'graph.facebook.com' in str(exc.request.url):
            logger.warning('[meta_comments] skipped facebook.com for instagram_login post=%s', pid)
            return {'ok': False, 'error': 'Instagram Login requires graph.instagram.com for comments', 'comments': []}
        if is_graph_oauth_invalid(meta):
            return {'ok': False, 'error': 'Meta OAuth token invalid', 'oauth_invalid': True, 'comments': []}
        if is_graph_rate_limited(meta):
            return {'ok': False, 'error': 'Meta rate limited', 'rate_limited': True, 'comments': []}
        logger.warning('[meta_comments] fetch failed provider=%s post=%s: %s', provider, pid, exc)
        return {'ok': False, 'error': str(exc), 'comments': []}
    except Exception as exc:
        logger.warning('[meta_comments] fetch failed provider=%s post=%s: %s', provider, pid, exc)
        return {'ok': False, 'error': str(exc), 'comments': []}


def reply_to_comment(
    *,
    provider_comment_id: str,
    message: str,
    access_token: str,
    provider: str,
    fb_cfg: Dict[str, Any],
) -> Dict[str, Any]:
    """Post a reply on Facebook or Instagram via Graph API."""
    cid = str(provider_comment_id or '').strip()
    text = str(message or '').strip()
    token = str(access_token or '').strip()
    if not cid or not text or not token:
        return {'ok': False, 'error': 'Missing provider_comment_id, message, or access_token'}

    prov = str(provider or '').lower()
    root = _api_root(prov, fb_cfg)
    if prov in ('instagram', 'instagram_login'):
        suffix = f'{cid}/replies'
    else:
        suffix = f'{cid}/comments'

    try:
        r = httpx.post(
            f'{root}/{suffix}',
            data={'message': text, 'access_token': token},
            timeout=60.0,
        )
        r.raise_for_status()
        reply_id = str((r.json() or {}).get('id') or '')
        return {'ok': True, 'provider_reply_id': reply_id or None}
    except httpx.HTTPStatusError as exc:
        meta = graph_error_meta(exc)
        if is_graph_oauth_invalid(meta):
            return {'ok': False, 'error': 'Meta OAuth token invalid', 'oauth_invalid': True}
        if is_graph_rate_limited(meta):
            return {'ok': False, 'error': 'Meta rate limited', 'rate_limited': True}
        logger.warning('[meta_comments] reply failed provider=%s comment=%s: %s', provider, cid, exc)
        return {'ok': False, 'error': str(exc)}
    except Exception as exc:
        logger.warning('[meta_comments] reply failed provider=%s comment=%s: %s', provider, cid, exc)
        return {'ok': False, 'error': str(exc)}
