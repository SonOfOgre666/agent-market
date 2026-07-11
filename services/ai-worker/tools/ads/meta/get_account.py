"""Tool: get Meta ad account details (reference get_account_info)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.meta_ads import get_account_info as connector_get_account_info
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')

    ad_account_id = payload.get('ad_account_id') or payload.get('account_id')
    if not ad_account_id:
        raise ToolValidationError('ad_account_id is required (Graph act_ id)')

    out = connector_get_account_info(
        token,
        account_id=str(ad_account_id),
        fields=str(payload.get('fields') or ''),
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        err: Dict[str, Any] = {
            'ok': False,
            'error': out.get('error') or 'Meta get account failed',
        }
        if out.get('accessible_accounts') is not None:
            err['accessible_accounts'] = out['accessible_accounts']
        if out.get('total_accessible_accounts') is not None:
            err['total_accessible_accounts'] = out['total_accessible_accounts']
        return err
    return out
