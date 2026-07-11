"""Tool: list Meta demographic targeting options (reference search_demographics)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.meta_ads.targeting_search import search_demographics as connector_search_demographics
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')
    out = connector_search_demographics(
        token,
        demographic_class=str(payload.get('demographic_class') or 'demographics'),
        limit=int(payload.get('limit') or 50),
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'search_demographics failed')
    return out
