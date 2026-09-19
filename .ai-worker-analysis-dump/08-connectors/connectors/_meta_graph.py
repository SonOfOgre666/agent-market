"""Shared Meta Graph (facebook.com) HTTP reads — no OAuth, no persistence."""

from __future__ import annotations

from typing import Any, Dict, Optional

import httpx

GRAPH = 'https://graph.facebook.com/v25.0'


def graph_get(path: str, params: Dict[str, Any], *, timeout: float) -> httpx.Response:
    """GET ``{GRAPH}/{path}`` with query params (caller supplies ``access_token``)."""
    url = f'{GRAPH}/{path.lstrip("/")}'
    return httpx.get(url, params=params, timeout=timeout)


def graph_error_meta(err: httpx.HTTPStatusError) -> Dict[str, Any]:
    sc = err.response.status_code if err.response is not None else 0
    fb_code: Optional[int] = None
    if err.response is not None:
        try:
            raw = err.response.json()
            err_obj = raw.get('error') if isinstance(raw, dict) else None
            if isinstance(err_obj, dict) and err_obj.get('code') is not None:
                fb_code = int(err_obj['code'])
        except Exception:
            pass
    return {'status_code': sc, 'fb_error_code': fb_code}


def is_graph_rate_limited(meta: Dict[str, Any]) -> bool:
    return int(meta.get('status_code') or 0) == 429


def is_graph_oauth_invalid(meta: Dict[str, Any]) -> bool:
    if int(meta.get('status_code') or 0) == 401:
        return True
    return meta.get('fb_error_code') == 190
