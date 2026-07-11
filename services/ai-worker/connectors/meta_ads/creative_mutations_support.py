"""Shared Graph helpers for creative/ad mutations (reference_ads/meta_ads/ads.py)."""

from __future__ import annotations

from typing import Any, Dict, Optional

import httpx

from .api import GraphAPIError, format_graph_error, graph_request
from .utils import ensure_act_prefix


def _graph(
    endpoint: str,
    access_token: str,
    params: Optional[Dict[str, Any]] = None,
    *,
    method: str = 'GET',
    api_version: str = 'v22.0',
) -> Dict[str, Any]:
    data = graph_request(
        endpoint,
        access_token,
        params=params or {},
        method=method,
        api_version=api_version,
    )
    if isinstance(data, dict) and data.get('ok') is False:
        return data
    if isinstance(data, dict) and 'error' in data:
        err = data['error']
        if isinstance(err, dict):
            raise GraphAPIError(err)
        return {'error': str(err)}
    return data if isinstance(data, dict) else {}


def _fail(msg: str, **extra: Any) -> Dict[str, Any]:
    out: Dict[str, Any] = {'ok': False, 'error': str(msg)}
    out.update(extra)
    return out


def _ok_creative(creative_id: str, details: Optional[Dict[str, Any]] = None, **extra: Any) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        'ok': True,
        'id': str(creative_id),
        'creative_id': str(creative_id),
    }
    if details is not None:
        out['creative'] = details
    out.update(extra)
    return out


def _fetch_video_thumbnail(vid_id: str, access_token: str, *, api_version: str = 'v22.0') -> Optional[str]:
    try:
        data = _graph(vid_id, access_token, {'fields': 'picture,thumbnails'}, api_version=api_version)
        thumbs = ((data.get('thumbnails') or {}).get('data') or []) if isinstance(data, dict) else []
        if thumbs and thumbs[0].get('uri'):
            return str(thumbs[0]['uri'])
        if isinstance(data, dict) and data.get('picture'):
            return str(data['picture'])
    except Exception:
        pass
    return None


def _discover_pages_for_account(
    account_id: str,
    access_token: str,
    *,
    api_version: str = 'v22.0',
) -> Dict[str, Any]:
    from .pages import discover_pages_for_account

    return discover_pages_for_account(access_token, account_id=account_id, api_version=api_version)


def _download_image_bytes(url: str) -> Optional[bytes]:
    try:
        with httpx.Client(timeout=60.0, follow_redirects=True) as client:
            r = client.get(url)
            r.raise_for_status()
            return r.content
    except Exception:
        return None
