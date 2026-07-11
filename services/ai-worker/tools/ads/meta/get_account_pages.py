"""Tool: list Facebook Pages for a Meta ad account (reference get_account_pages)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.meta_ads.pages import get_account_pages as connector_get_account_pages
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')

    account_id = payload.get('ad_account_id') or payload.get('account_id')
    if not account_id:
        raise ToolValidationError('ad_account_id is required')

    out = connector_get_account_pages(
        token,
        account_id=str(account_id),
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'Meta get account pages failed')
    return out
