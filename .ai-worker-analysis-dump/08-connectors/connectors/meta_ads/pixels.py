"""Meta Ads pixel CRUD (list/create/get/update) — Graph Marketing API."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from .api import GraphAPIError, format_graph_error, graph_request
from .utils import ensure_act_prefix

_PIXEL_LIST_FIELDS = 'id,name,creation_time,last_fired_time,is_unavailable,code'
_PIXEL_DETAIL_FIELDS = (
    'id,name,creation_time,last_fired_time,is_unavailable,code,'
    'enable_automatic_matching,data_use_setting,first_party_cookie_status,automatic_matching_fields'
)


def _map_picker_row(row: Dict[str, Any]) -> Dict[str, Any]:
    pid = str(row.get('id') or '').strip()
    return {
        'id': pid,
        'pixel_id': pid,
        'name': str(row.get('name') or pid or 'Pixel'),
        'is_unavailable': bool(row.get('is_unavailable')),
        'last_fired_time': row.get('last_fired_time'),
        'creation_time': row.get('creation_time'),
    }


def list_ad_pixels(
    access_token: str,
    *,
    account_id: str,
    limit: int = 50,
    after: str = '',
    api_version: str = 'v22.0',
    timeout: float = 120.0,
) -> Dict[str, Any]:
    """
    Graph GET ``/{act}/adspixels`` — pixels shared with or owned by the ad account.

    When exactly one pixel is available (not ``is_unavailable``), returns ``default_pixel_id``
  for agent/UI auto-selection without asking the user.
    """
    if not access_token:
        return {'ok': False, 'error': 'access_token is required', 'data': [], 'pixels': []}
    if not account_id:
        return {'ok': False, 'error': 'ad_account_id is required', 'data': [], 'pixels': []}

    act_id = ensure_act_prefix(account_id)
    params: Dict[str, Any] = {
        'fields': _PIXEL_LIST_FIELDS,
        'limit': str(max(1, min(500, int(limit)))),
    }
    if after:
        params['after'] = str(after).strip()

    try:
        data = graph_request(
            f'{act_id}/adspixels',
            access_token,
            params=params,
            method='GET',
            api_version=api_version,
            timeout=timeout,
        )
    except GraphAPIError as exc:
        err = exc.error_data if isinstance(exc.error_data, dict) else {'message': str(exc)}
        return {'ok': False, 'error': format_graph_error(err), 'data': [], 'pixels': []}

    if data.get('ok') is False:
        return {**data, 'data': [], 'pixels': []}
    if isinstance(data, dict) and 'error' in data:
        err = data['error']
        return {
            'ok': False,
            'error': format_graph_error(err) if isinstance(err, dict) else str(err),
            'data': [],
            'pixels': [],
        }

    rows = [dict(x) for x in (data.get('data') or []) if isinstance(x, dict)]
    pixels = [_map_picker_row(r) for r in rows]
    available = [p for p in pixels if not p.get('is_unavailable')]
    default_pixel_id: Optional[str] = available[0]['pixel_id'] if len(available) == 1 else None

    return {
        'ok': True,
        'data': rows,
        'pixels': pixels,
        'default_pixel_id': default_pixel_id,
        'paging': data.get('paging') if isinstance(data, dict) else None,
    }


def create_ad_pixel(
    access_token: str,
    *,
    account_id: str,
    name: str,
    api_version: str = 'v22.0',
    timeout: float = 120.0,
) -> Dict[str, Any]:
    """
    Graph POST ``/{act}/adspixels`` — official Marketing API pixel create.

    Meta may reject if a pixel already exists (error codes 6200 / 6202). Prefer
    ``list_ad_pixels`` first and reuse an existing ``pixel_id`` when possible.
    """
    if not access_token:
        return {'ok': False, 'error': 'access_token is required'}
    if not account_id:
        return {'ok': False, 'error': 'ad_account_id is required'}
    pixel_name = str(name or '').strip()
    if not pixel_name:
        return {'ok': False, 'error': 'name is required'}

    act_id = ensure_act_prefix(account_id)
    try:
        data = graph_request(
            f'{act_id}/adspixels',
            access_token,
            params={'name': pixel_name},
            method='POST',
            api_version=api_version,
            timeout=timeout,
        )
    except GraphAPIError as exc:
        err = exc.error_data if isinstance(exc.error_data, dict) else {'message': str(exc)}
        return {'ok': False, 'error': format_graph_error(err), 'error_data': err}

    if data.get('ok') is False:
        return data
    if isinstance(data, dict) and 'error' in data:
        err = data['error']
        err_data = err if isinstance(err, dict) else {'message': str(err)}
        code = err_data.get('code')
        subcode = err_data.get('error_subcode')
        msg = format_graph_error(err_data)
        if code == 6200 or subcode == 6200:
            msg = (
                'A pixel already exists for this ad account (Meta 6200). '
                'Use meta_list_ad_pixels and reuse pixel_id instead of creating another.'
            )
        elif code == 6202 or subcode == 6202:
            msg = (
                'More than one pixel already exists for this account (Meta 6202). '
                'Use meta_list_ad_pixels to pick the correct pixel_id.'
            )
        return {'ok': False, 'error': msg, 'error_data': err_data}

    pixel_id = str(data.get('id') or '').strip()
    if not pixel_id:
        return {'ok': False, 'error': 'Meta API did not return pixel id', 'response': data}

    return {
        'ok': True,
        'id': pixel_id,
        'pixel_id': pixel_id,
        'name': pixel_name,
    }


def get_ad_pixel(
    access_token: str,
    *,
    pixel_id: str,
    api_version: str = 'v22.0',
    timeout: float = 120.0,
) -> Dict[str, Any]:
    """Graph GET ``/{pixel_id}`` — single Ads Pixel node."""
    if not access_token:
        return {'ok': False, 'error': 'access_token is required'}
    pid = str(pixel_id or '').strip().lstrip('/')
    if not pid:
        return {'ok': False, 'error': 'pixel_id is required'}

    try:
        data = graph_request(
            pid,
            access_token,
            params={'fields': _PIXEL_DETAIL_FIELDS},
            method='GET',
            api_version=api_version,
            timeout=timeout,
        )
    except GraphAPIError as exc:
        err = exc.error_data if isinstance(exc.error_data, dict) else {'message': str(exc)}
        return {'ok': False, 'error': format_graph_error(err)}

    if data.get('ok') is False:
        return data
    if isinstance(data, dict) and 'error' in data:
        err = data['error']
        return {
            'ok': False,
            'error': format_graph_error(err) if isinstance(err, dict) else str(err),
        }

    row = dict(data) if isinstance(data, dict) else {}
    mapped = _map_picker_row(row)
    return {'ok': True, 'pixel': mapped, 'data': row}


def update_ad_pixel(
    access_token: str,
    *,
    pixel_id: str,
    name: Optional[str] = None,
    enable_automatic_matching: Optional[bool] = None,
    data_use_setting: Optional[str] = None,
    first_party_cookie_status: Optional[str] = None,
    automatic_matching_fields: Optional[List[str]] = None,
    server_events_business_ids: Optional[List[str]] = None,
    api_version: str = 'v22.0',
    timeout: float = 120.0,
) -> Dict[str, Any]:
    """
    Graph POST ``/{pixel_id}`` — official Marketing API pixel update.

    Meta does not expose DELETE on the Ads Pixel node; removal is not supported here.
    """
    if not access_token:
        return {'ok': False, 'error': 'access_token is required'}
    pid = str(pixel_id or '').strip().lstrip('/')
    if not pid:
        return {'ok': False, 'error': 'pixel_id is required'}

    params: Dict[str, Any] = {}
    if name is not None:
        pixel_name = str(name).strip()
        if not pixel_name:
            return {'ok': False, 'error': 'name cannot be empty when provided'}
        params['name'] = pixel_name
    if enable_automatic_matching is not None:
        params['enable_automatic_matching'] = 'true' if bool(enable_automatic_matching) else 'false'
    if data_use_setting is not None:
        params['data_use_setting'] = str(data_use_setting).strip()
    if first_party_cookie_status is not None:
        params['first_party_cookie_status'] = str(first_party_cookie_status).strip()
    if automatic_matching_fields is not None:
        if not isinstance(automatic_matching_fields, list):
            return {'ok': False, 'error': 'automatic_matching_fields must be a list'}
        params['automatic_matching_fields'] = json.dumps(automatic_matching_fields)
    if server_events_business_ids is not None:
        if not isinstance(server_events_business_ids, list):
            return {'ok': False, 'error': 'server_events_business_ids must be a list'}
        params['server_events_business_ids'] = json.dumps(server_events_business_ids)

    if not params:
        return {'ok': False, 'error': 'No update parameters provided'}

    try:
        data = graph_request(
            pid,
            access_token,
            params=params,
            method='POST',
            api_version=api_version,
            timeout=timeout,
        )
    except GraphAPIError as exc:
        err = exc.error_data if isinstance(exc.error_data, dict) else {'message': str(exc)}
        return {'ok': False, 'error': format_graph_error(err), 'error_data': err}

    if data.get('ok') is False:
        return data
    if isinstance(data, dict) and 'error' in data:
        err = data['error']
        err_data = err if isinstance(err, dict) else {'message': str(err)}
        return {'ok': False, 'error': format_graph_error(err_data), 'error_data': err_data}

    out: Dict[str, Any] = {'ok': True, 'pixel_id': pid}
    if isinstance(data, dict):
        out.update(data)
    else:
        out['response'] = data
    if out.get('success') is True or out.get('id'):
        out['pixel_id'] = str(out.get('id') or pid)
    return out


def resolve_default_pixel_id(
    access_token: str,
    *,
    account_id: str,
    api_version: str = 'v22.0',
) -> Optional[str]:
    """Return the sole available pixel id, or None if zero or multiple."""
    out = list_ad_pixels(
        access_token,
        account_id=account_id,
        limit=50,
        api_version=api_version,
    )
    if not out.get('ok'):
        return None
    return out.get('default_pixel_id')
