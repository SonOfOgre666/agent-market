"""Tool: search Meta Ads Library (reference search_ads_archive)."""

from __future__ import annotations

from typing import Any, Dict, List, Union

from connectors.meta_ads.ads_library import search_ads_archive
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')

    search_terms = (payload.get('search_terms') or payload.get('q') or '').strip()
    if not search_terms:
        raise ToolValidationError('search_terms is required')

    countries = payload.get('ad_reached_countries') or payload.get('countries')
    if not countries:
        raise ToolValidationError('ad_reached_countries is required (e.g. ["US"] or "US,GB")')

    out = search_ads_archive(
        token,
        search_terms=search_terms,
        ad_reached_countries=countries,
        ad_type=str(payload.get('ad_type') or 'ALL'),
        limit=int(payload.get('limit') or 25),
        fields=str(payload.get('fields') or ''),
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'Meta Ads Library search failed')
    return {'ok': True, 'data': out.get('data') or [], 'paging': out.get('paging')}
