"""Tool: list Meta campaigns for an ad account (reference get_campaigns)."""

from __future__ import annotations

from typing import Any, Dict, List, Union

from connectors.meta_ads import list_campaigns as connector_list_campaigns
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')

    ad_account_id = payload.get('ad_account_id') or payload.get('account_id')
    if not ad_account_id:
        raise ToolValidationError('ad_account_id is required (Graph act_ id)')

    limit = int(payload.get('limit') or 50)
    status_filter = str(payload.get('status_filter') or payload.get('effective_status') or '').strip()
    after = str(payload.get('after') or '').strip()
    obj = payload.get('objective_filter') or payload.get('objectives')
    objective_filter: Union[str, List[str]] = ''
    if isinstance(obj, list):
        objective_filter = [str(x) for x in obj if x]
    elif obj:
        objective_filter = str(obj)

    out = connector_list_campaigns(
        token,
        account_id=str(ad_account_id),
        limit=limit,
        status_filter=status_filter,
        objective_filter=objective_filter,
        after=after,
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'Meta list campaigns failed')
    return {'ok': True, 'data': out.get('data') or [], 'paging': out.get('paging')}
