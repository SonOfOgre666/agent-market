"""Meta Graph API transport — execution only (no OAuth, no MCP)."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

import httpx

logger = logging.getLogger(__name__)

GRAPH = 'https://graph.facebook.com'
DEFAULT_API_VERSION = 'v22.0'


class GraphAPIError(Exception):
    def __init__(self, error_data: Dict[str, Any]):
        self.error_data = error_data
        self.message = error_data.get('message', 'Unknown Graph API error')
        super().__init__(self.message)


_META_ERROR_HINTS = {
    1885183: (
        'Your Meta (Facebook) app is in Development mode. In developers.facebook.com → '
        'My Apps → your app → switch App mode to Live, complete App Review for '
        'ads_management (and pages_show_list if using Pages), then reconnect Meta Ads in Agent Market.'
    ),
    2490408: (
        'This optimization_goal does not match the campaign objective or ad format. '
        'Check objective × optimization_goal × destination_type. Engagement needs ON_POST or ON_VIDEO (not WEBSITE). '
        'THRUPLAY needs video_id.'
    ),
    3858327: (
        'optimization_goal IMPRESSIONS is no longer available for this objective. '
        'Use REACH (maximize people who see the ad) or POST_ENGAGEMENT for Engagement campaigns.'
    ),
    1815430: (
        'Ad set requires promoted_object (e.g. application_id + object_store_url for App promotion, '
        'pixel_id for Sales conversions, page_id for lead forms).'
    ),
    1815089: (
        'This Facebook Page has not accepted Meta Lead Generation Terms of Service. '
        'Open https://www.facebook.com/ads/leadgen/tos while logged in as a Page admin, '
        'select Page ID shown in the error (or your campaign Page), accept the terms, then retry. '
        'Use the same Meta user/token that accepted the terms when reconnecting in Agent Market.'
    ),
}


def format_graph_error(err: Any) -> str:
    """Human-readable Meta error (reference_ads surfaces error_user_msg + subcode)."""
    if not isinstance(err, dict):
        return str(err)
    parts = [str(err.get('message') or 'Graph API error')]
    if err.get('error_user_msg'):
        parts.append(str(err['error_user_msg']))
    sub = err.get('error_subcode')
    if sub is not None:
        parts.append(f'subcode={sub}')
        hint = _META_ERROR_HINTS.get(int(sub)) if str(sub).isdigit() else None
        if hint:
            parts.append(hint)
    return ' — '.join(p for p in parts if p)


def graph_request(
    endpoint: str,
    access_token: str,
    *,
    params: Optional[Dict[str, Any]] = None,
    method: str = 'GET',
    api_version: str = DEFAULT_API_VERSION,
    timeout: float = 120.0,
) -> Dict[str, Any]:
    """Call Meta Graph API; returns parsed JSON dict."""
    if not access_token:
        return {
            'error': {
                'message': 'Authentication Required',
                'details': 'access_token is required',
            }
        }

    ver = (api_version or DEFAULT_API_VERSION).strip()
    if not ver.startswith('v'):
        ver = f'v{ver}'
    url = f'{GRAPH}/{ver}/{endpoint.lstrip("/")}'

    request_params: Dict[str, Any] = dict(params or {})
    request_params['access_token'] = access_token

    headers = {'User-Agent': 'agent-market/1.0'}

    try:
        with httpx.Client(timeout=timeout) as client:
            if method == 'GET':
                encoded = {}
                for key, value in request_params.items():
                    if isinstance(value, (dict, list)):
                        encoded[key] = json.dumps(value)
                    else:
                        encoded[key] = value
                resp = client.get(url, params=encoded, headers=headers)
            elif method == 'POST':
                post_params = {}
                for key, value in request_params.items():
                    if isinstance(value, (dict, list)):
                        post_params[key] = json.dumps(value)
                    else:
                        post_params[key] = value
                resp = client.post(url, data=post_params, headers=headers)
            elif method == 'DELETE':
                resp = client.delete(url, params=request_params, headers=headers)
            else:
                raise ValueError(f'Unsupported HTTP method: {method}')

            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as err:
        sc = err.response.status_code if err.response is not None else 502
        try:
            body = err.response.json() if err.response is not None else {}
            err_obj = body.get('error') if isinstance(body, dict) else None
            if isinstance(err_obj, dict):
                return {
                    'ok': False,
                    'error': format_graph_error(err_obj),
                    'http_status': sc,
                    'error_data': err_obj,
                }
        except Exception:
            pass
        return {'ok': False, 'error': str(err), 'http_status': sc}
    except Exception as exc:
        return {'ok': False, 'error': str(exc), 'http_status': 502}

    if isinstance(data, dict) and 'error' in data:
        err_obj = data['error']
        if isinstance(err_obj, dict):
            raise GraphAPIError(err_obj)
        return {'ok': False, 'error': str(err_obj), 'error_data': data}

    return data if isinstance(data, dict) else {'data': data}
