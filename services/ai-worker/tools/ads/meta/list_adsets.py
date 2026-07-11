"""Tool: list Meta ad sets for a campaign or ad account (reference get_adsets)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.meta_ads import list_adsets as connector_list_adsets
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')

    campaign_id = str(payload.get('campaign_id') or payload.get('platform_campaign_id') or '').strip()
    ad_account_id = str(payload.get('ad_account_id') or payload.get('account_id') or '').strip()
    if not campaign_id and not ad_account_id:
        raise ToolValidationError('campaign_id or ad_account_id is required')

    limit = int(payload.get('limit') or 50)
    after = str(payload.get('after') or '').strip()

    out = connector_list_adsets(
        token,
        account_id=ad_account_id,
        campaign_id=campaign_id,
        limit=limit,
        after=after,
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'Meta list ad sets failed')
    return {'ok': True, 'data': out.get('data') or [], 'paging': out.get('paging')}
