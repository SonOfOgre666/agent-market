"""Instagram account + media analytics (Graph facebook.com or graph.instagram.com)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx

from connectors._meta_graph import graph_error_meta, is_graph_oauth_invalid, is_graph_rate_limited

logger = logging.getLogger(__name__)

IG_LOGIN_ROOT = 'https://graph.instagram.com/v21.0'
ACCOUNT_INSIGHT_METRICS = 'reach,views'
MEDIA_INSIGHT_METRICS = 'reach,views,likes,comments'


def _fb_root(fb_cfg: Optional[Dict[str, Any]]) -> str:
    v = str((fb_cfg or {}).get('api_version') or 'v25.0').strip()
    if not v.startswith('v'):
        v = f'v{v}'
    return f'https://graph.facebook.com/{v}'


def _api_root(provider: str, fb_cfg: Optional[Dict[str, Any]] = None) -> str:
    if provider == 'instagram_login':
        return IG_LOGIN_ROOT
    return _fb_root(fb_cfg)


def _graph_result(resp: httpx.Response) -> Dict[str, Any]:
    resp.raise_for_status()
    return resp.json() if resp.content else {}


def _request_error(err: httpx.HTTPStatusError) -> Dict[str, Any]:
    meta = graph_error_meta(err)
    if is_graph_rate_limited(meta):
        return {'ok': False, 'rate_limited': True, **meta}
    if is_graph_oauth_invalid(meta):
        return {'ok': False, 'unauthorized': True, **meta}
    if int(meta.get('status_code') or 0) == 403:
        return {'ok': False, 'forbidden': True, **meta, 'error': str(err)}
    return {'ok': False, 'retryable': True, **meta, 'error': str(err)}


def _insight_points(insight: dict) -> List[Tuple[str, int]]:
    """Return ``[(iso_date, value), ...]`` from a Graph insights metric object."""
    name = str(insight.get('name') or '')
    if not name:
        return []
    points: List[Tuple[str, int]] = []

    total = insight.get('total_value')
    if isinstance(total, dict) and total.get('value') is not None:
        end_time = str(insight.get('end_time') or '')
        date = end_time.split('T')[0] if end_time else datetime.now(timezone.utc).date().isoformat()
        points.append((date, int(total.get('value') or 0)))
        return points

    for item in insight.get('values') or []:
        end_time = str(item.get('end_time') or '')
        date = end_time.split('T')[0] if end_time else ''
        if not date:
            continue
        val = item.get('value')
        if val is None:
            continue
        points.append((date, int(val)))
    return points


def fetch_user_followers_count(
    access_token: str,
    user_id: str,
    *,
    provider: str,
    fb_cfg: Optional[Dict[str, Any]] = None,
    timeout: float = 60.0,
) -> Dict[str, Any]:
    """IG User ``followers_count`` (``instagram_business_basic``)."""
    root = _api_root(provider, fb_cfg)
    path = 'me' if provider == 'instagram_login' else str(user_id)
    params = {'fields': 'followers_count', 'access_token': access_token}
    try:
        resp = httpx.get(f'{root}/{path}', params=params, timeout=timeout)
        payload = _graph_result(resp)
        total = int(payload.get('followers_count') or 0)
        return {'ok': True, 'followers_count': total}
    except httpx.HTTPStatusError as err:
        return _request_error(err)
    except Exception as exc:
        return {'ok': False, 'error': str(exc)}


def fetch_account_insights_day_series(
    access_token: str,
    user_id: str,
    *,
    provider: str,
    since: str,
    until: str,
    fb_cfg: Optional[Dict[str, Any]] = None,
    timeout: float = 120.0,
) -> Dict[str, Any]:
    """
    Account-level ``reach`` and ``views`` (requires ``*_manage_insights`` scope).

    ``since`` / ``until`` are ISO dates (YYYY-MM-DD); converted to unix for the API.
    """
    root = _api_root(provider, fb_cfg)
    since_dt = datetime.fromisoformat(since).replace(tzinfo=timezone.utc)
    until_dt = datetime.fromisoformat(until).replace(tzinfo=timezone.utc)
    params = {
        'metric': ACCOUNT_INSIGHT_METRICS,
        'period': 'day',
        'metric_type': 'total_value',
        'since': int(since_dt.timestamp()),
        'until': int(until_dt.timestamp()),
        'access_token': access_token,
    }
    try:
        resp = httpx.get(f'{root}/{user_id}/insights', params=params, timeout=timeout)
        payload = _graph_result(resp)
        by_date: Dict[str, Dict[str, int]] = {}
        for insight in payload.get('data') or []:
            metric = str(insight.get('name') or '')
            if not metric:
                continue
            for date, value in _insight_points(insight):
                by_date.setdefault(date, {})[metric] = value
        rows = [{'date': d, **vals} for d, vals in sorted(by_date.items())]
        return {'ok': True, 'rows': rows}
    except httpx.HTTPStatusError as err:
        return _request_error(err)
    except Exception as exc:
        return {'ok': False, 'error': str(exc)}


def fetch_user_media_page(
    access_token: str,
    user_id: str,
    *,
    provider: str,
    after: str = '',
    fb_cfg: Optional[Dict[str, Any]] = None,
    timeout: float = 120.0,
) -> Dict[str, Any]:
    """One page of the user's media with basic engagement fields."""
    root = _api_root(provider, fb_cfg)
    params = {
        'fields': 'id,caption,timestamp,media_type,like_count,comments_count',
        'limit': '25',
        'access_token': access_token,
    }
    if after:
        params['after'] = after
    try:
        resp = httpx.get(f'{root}/{user_id}/media', params=params, timeout=timeout)
        payload = _graph_result(resp)
        media = list(payload.get('data') or [])
        paging = payload.get('paging') or {}
        cursors = paging.get('cursors') or {}
        next_after = str(cursors.get('after') or '')
        return {'ok': True, 'media': media, 'next_after': next_after}
    except httpx.HTTPStatusError as err:
        return _request_error(err)
    except Exception as exc:
        return {'ok': False, 'error': str(exc)}


def fetch_media_insights(
    access_token: str,
    media_id: str,
    *,
    provider: str,
    fb_cfg: Optional[Dict[str, Any]] = None,
    timeout: float = 60.0,
) -> Dict[str, Any]:
    """Lifetime media metrics (best-effort; skips unsupported metrics per media type)."""
    root = _api_root(provider, fb_cfg)
    params = {
        'metric': MEDIA_INSIGHT_METRICS,
        'access_token': access_token,
    }
    try:
        resp = httpx.get(f'{root}/{media_id}/insights', params=params, timeout=timeout)
        payload = _graph_result(resp)
        metrics: Dict[str, int] = {}
        for row in payload.get('data') or []:
            name = str(row.get('name') or '')
            if not name:
                continue
            values = row.get('values') or []
            if values:
                metrics[name] = int(values[-1].get('value') or 0)
            elif isinstance(row.get('total_value'), dict):
                metrics[name] = int(row['total_value'].get('value') or 0)
        return {'ok': True, 'metrics': metrics}
    except httpx.HTTPStatusError as err:
        meta = graph_error_meta(err)
        if int(meta.get('status_code') or 0) in (400, 403):
            return {'ok': True, 'metrics': {}, 'skipped': True}
        return _request_error(err)
    except Exception as exc:
        return {'ok': False, 'error': str(exc)}
