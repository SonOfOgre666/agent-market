"""Meta Ads Library — reference ``search_ads_archive`` (no MCP)."""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional, Union

from .api import GraphAPIError, format_graph_error, graph_request

_DEFAULT_ARCHIVE_FIELDS = (
    'ad_creation_time,ad_creative_body,ad_creative_link_caption,ad_creative_link_description,'
    'ad_creative_link_title,ad_delivery_start_time,ad_delivery_stop_time,ad_snapshot_url,currency,'
    'demographic_distribution,funding_entity,impressions,page_id,page_name,publisher_platform,'
    'region_distribution,spend'
)


def ads_library_enabled() -> bool:
    v = os.environ.get('META_ADS_DISABLE_ADS_LIBRARY', '').strip().lower()
    return v not in ('1', 'true', 'yes')


def search_ads_archive(
    access_token: str,
    *,
    search_terms: str,
    ad_reached_countries: Union[List[str], str],
    ad_type: str = 'ALL',
    limit: int = 25,
    fields: str = '',
    api_version: str = 'v22.0',
    timeout: float = 120.0,
) -> Dict[str, Any]:
    """
    GET ``/ads_archive`` — reference ``search_ads_archive``.

    Requires an access token with ads_read / Ads Library permissions.
    """
    if not ads_library_enabled():
        return {
            'ok': False,
            'error': 'Ads Library is disabled (META_ADS_DISABLE_ADS_LIBRARY is set)',
        }

    if not access_token:
        return {'ok': False, 'error': 'access_token is required'}
    if not search_terms:
        return {'ok': False, 'error': 'search_terms is required'}
    if not ad_reached_countries:
        return {'ok': False, 'error': 'ad_reached_countries is required'}

    countries: List[str]
    if isinstance(ad_reached_countries, list):
        countries = [str(c) for c in ad_reached_countries if c]
    else:
        raw = str(ad_reached_countries).strip()
        if raw.startswith('['):
            try:
                parsed = json.loads(raw)
                countries = [str(c) for c in parsed if c] if isinstance(parsed, list) else [raw]
            except json.JSONDecodeError:
                countries = [c.strip() for c in raw.split(',') if c.strip()]
        else:
            countries = [c.strip() for c in raw.split(',') if c.strip()]

    if not countries:
        return {'ok': False, 'error': 'ad_reached_countries must be a non-empty list'}

    params: Dict[str, Any] = {
        'search_terms': str(search_terms),
        'ad_type': str(ad_type or 'ALL'),
        'ad_reached_countries': json.dumps(countries),
        'limit': str(max(1, min(500, int(limit)))),
        'fields': fields.strip() if fields else _DEFAULT_ARCHIVE_FIELDS,
    }

    try:
        data = graph_request(
            'ads_archive',
            access_token,
            params=params,
            method='GET',
            api_version=api_version,
            timeout=timeout,
        )
    except GraphAPIError as exc:
        err = exc.error_data if isinstance(exc.error_data, dict) else {'message': str(exc)}
        return {'ok': False, 'error': format_graph_error(err), 'data': []}

    if data.get('ok') is False:
        return {**data, 'data': []}
    if isinstance(data, dict) and 'error' in data:
        err = data['error']
        return {
            'ok': False,
            'error': format_graph_error(err) if isinstance(err, dict) else str(err),
            'data': [],
        }

    return {'ok': True, 'data': data.get('data') or [], 'paging': data.get('paging')}
