"""Tool: list Meta ad accounts (reference get_ad_accounts)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.meta_ads import list_ad_accounts
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')

    out = list_ad_accounts(
        token,
        user_id=str(payload.get('user_id') or 'me'),
        limit=int(payload.get('limit') or 200),
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'Meta ad accounts request failed')
    return {
        'ok': True,
        'accounts': out.get('accounts') or [],
        'data': out.get('data') or [],
        'paging': out.get('paging'),
    }
