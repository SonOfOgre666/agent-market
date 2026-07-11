"""Tool: search Meta geo locations (reference search_geo_locations)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.meta_ads.targeting_search import search_geo_locations as connector_search_geo_locations
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')
    query = (payload.get('query') or '').strip()
    if not query:
        raise ToolValidationError('query is required')
    out = connector_search_geo_locations(
        token,
        query=query,
        location_types=payload.get('location_types'),
        limit=int(payload.get('limit') or 25),
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'search_geo_locations failed')
    return out
