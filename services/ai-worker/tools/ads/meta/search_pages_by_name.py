"""Tool: search Facebook Pages by name (reference search_pages_by_name)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.meta_ads.pages import search_pages_by_name as connector_search_pages_by_name
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')

    account_id = payload.get('ad_account_id') or payload.get('account_id')
    if not account_id:
        raise ToolValidationError('ad_account_id is required')

    out = connector_search_pages_by_name(
        token,
        account_id=str(account_id),
        search_term=payload.get('search_term') or payload.get('q'),
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'Meta search pages failed')
    return out
