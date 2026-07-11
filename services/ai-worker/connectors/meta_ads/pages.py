"""Facebook Page discovery for Meta creatives — reference get_account_pages / search_pages_by_name."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Set

from .creative_mutations_support import _graph
from .utils import ensure_act_prefix

logger = logging.getLogger(__name__)

_PAGE_FIELDS = 'id,name,username,category,fan_count,link,verification_status,picture'


def _collect_page_ids_from_ads(act_id: str, access_token: str, *, api_version: str) -> Set[str]:
    ids: Set[str] = set()
    try:
        data = _graph(
            f'{act_id}/ads',
            access_token,
            {'fields': 'creative{object_story_spec{page_id}},tracking_specs', 'limit': '100'},
            api_version=api_version,
        )
        for ad in data.get('data') or []:
            creative = ad.get('creative') or {}
            oss = creative.get('object_story_spec') or {}
            if oss.get('page_id'):
                ids.add(str(oss['page_id']))
            for spec in ad.get('tracking_specs') or []:
                if isinstance(spec, dict) and spec.get('page'):
                    for pid in spec['page']:
                        if str(pid).isdigit():
                            ids.add(str(pid))
    except Exception as exc:
        logger.debug('[pages] ads page collect failed: %s', exc)
    return ids


def _fetch_page_details(
    page_ids: Set[str],
    access_token: str,
    *,
    api_version: str,
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for page_id in page_ids:
        try:
            page_data = _graph(page_id, access_token, {'fields': _PAGE_FIELDS}, api_version=api_version)
            if page_data.get('id'):
                rows.append(page_data)
            else:
                rows.append({'id': page_id, 'error': 'Page details not accessible'})
        except Exception as exc:
            rows.append({'id': page_id, 'error': str(exc)})
    return rows


def discover_pages_for_account(
    access_token: str,
    *,
    account_id: str,
    api_version: str = 'v22.0',
) -> Dict[str, Any]:
    """Best single page for auto page_id — reference ``_discover_pages_for_account``."""
    act_id = ensure_act_prefix(account_id)
    page_ids = _collect_page_ids_from_ads(act_id, access_token, api_version=api_version)
    if page_ids:
        pid = next(iter(page_ids))
        try:
            page_data = _graph(pid, access_token, {'fields': _PAGE_FIELDS}, api_version=api_version)
            if page_data.get('id'):
                return {
                    'success': True,
                    'page_id': str(page_data['id']),
                    'page_name': page_data.get('name'),
                    'source': 'tracking_specs',
                }
        except Exception:
            return {'success': True, 'page_id': pid, 'page_name': None, 'source': 'tracking_specs'}

    for endpoint in (f'{act_id}/client_pages', f'{act_id}/promote_pages', f'{act_id}/assigned_pages'):
        try:
            data = _graph(endpoint, access_token, {'fields': _PAGE_FIELDS, 'limit': '1'}, api_version=api_version)
            rows = data.get('data') or []
            if rows:
                p = rows[0]
                return {
                    'success': True,
                    'page_id': str(p.get('id')),
                    'page_name': p.get('name'),
                    'source': endpoint.split('/')[-1],
                }
        except Exception:
            continue
    return {'success': False, 'message': 'No suitable pages found for this account'}


def get_account_pages(
    access_token: str,
    *,
    account_id: str,
    api_version: str = 'v22.0',
) -> Dict[str, Any]:
    """List pages for an ad account — reference ``get_account_pages``."""
    if not account_id:
        return {'ok': False, 'error': 'account_id is required', 'data': []}

    if str(account_id).strip() == 'me':
        try:
            data = _graph('me/accounts', access_token, {'fields': _PAGE_FIELDS}, api_version=api_version)
            return {'ok': True, 'data': list(data.get('data') or []), 'total_pages_found': len(data.get('data') or [])}
        except Exception as exc:
            return {'ok': False, 'error': str(exc), 'data': []}

    act_id = ensure_act_prefix(account_id)
    all_page_ids: Set[str] = set()

    try:
        user_pages = _graph('me/accounts', access_token, {'fields': _PAGE_FIELDS}, api_version=api_version)
        for page in user_pages.get('data') or []:
            if page.get('id'):
                all_page_ids.add(str(page['id']))
    except Exception:
        pass

    raw_id = act_id.replace('act_', '', 1)
    try:
        biz = _graph(f'{raw_id}/owned_pages', access_token, {'fields': _PAGE_FIELDS}, api_version=api_version)
        for page in biz.get('data') or []:
            if page.get('id'):
                all_page_ids.add(str(page['id']))
    except Exception:
        pass

    for endpoint in (f'{act_id}/client_pages', f'{act_id}/promote_pages'):
        try:
            data = _graph(endpoint, access_token, {'fields': _PAGE_FIELDS, 'limit': '100'}, api_version=api_version)
            for page in data.get('data') or []:
                if page.get('id'):
                    all_page_ids.add(str(page['id']))
        except Exception:
            pass

    try:
        creatives = _graph(
            f'{act_id}/adcreatives',
            access_token,
            {'fields': 'object_story_spec', 'limit': '100'},
            api_version=api_version,
        )
        for cr in creatives.get('data') or []:
            oss = cr.get('object_story_spec') or {}
            if oss.get('page_id'):
                all_page_ids.add(str(oss['page_id']))
    except Exception:
        pass

    all_page_ids.update(_collect_page_ids_from_ads(act_id, access_token, api_version=api_version))

    try:
        promoted = _graph(
            f'{act_id}/promoted_objects',
            access_token,
            {'fields': 'page_id', 'limit': '100'},
            api_version=api_version,
        )
        for obj in promoted.get('data') or []:
            if obj.get('page_id'):
                all_page_ids.add(str(obj['page_id']))
    except Exception:
        pass

    try:
        camps = _graph(
            f'{act_id}/campaigns',
            access_token,
            {'fields': 'promoted_object', 'limit': '50'},
            api_version=api_version,
        )
        for camp in camps.get('data') or []:
            po = camp.get('promoted_object') or {}
            if po.get('page_id'):
                all_page_ids.add(str(po['page_id']))
    except Exception:
        pass

    if not all_page_ids:
        return {
            'ok': True,
            'data': [],
            'total_pages_found': 0,
            'message': 'No pages found associated with this account',
        }

    rows = _fetch_page_details(all_page_ids, access_token, api_version=api_version)
    return {'ok': True, 'data': rows, 'total_pages_found': len(all_page_ids)}


def search_pages_by_name(
    access_token: str,
    *,
    account_id: str,
    search_term: Optional[str] = None,
    api_version: str = 'v22.0',
) -> Dict[str, Any]:
    """Filter account pages by name — reference ``search_pages_by_name``."""
    res = get_account_pages(access_token, account_id=account_id, api_version=api_version)
    if not res.get('ok'):
        return res
    rows = list(res.get('data') or [])
    if search_term:
        term = str(search_term).lower()
        rows = [p for p in rows if term in str(p.get('name') or '').lower()]
    return {
        'ok': True,
        'data': rows,
        'search_term': search_term,
        'total_found': len(rows),
        'total_available': res.get('total_pages_found', len(rows)),
    }
