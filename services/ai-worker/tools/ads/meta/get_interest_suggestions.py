"""Tool: Meta interest suggestions (reference get_interest_suggestions)."""

from __future__ import annotations

from typing import Any, Dict, List

from connectors.meta_ads.targeting_search import get_interest_suggestions as connector_get_interest_suggestions
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')
    interest_list: List[str] = list(payload.get('interest_list') or [])
    if not interest_list:
        raise ToolValidationError('interest_list is required')
    out = connector_get_interest_suggestions(
        token,
        interest_list=interest_list,
        limit=int(payload.get('limit') or 25),
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'get_interest_suggestions failed')
    return out
