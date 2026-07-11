"""Tool: list Meta ads (reference get_ads)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.meta_ads import list_ads as connector_list_ads
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')

    campaign_id = str(payload.get('campaign_id') or payload.get('platform_campaign_id') or '').strip()
    adset_id = str(payload.get('adset_id') or payload.get('ad_set_id') or payload.get('platform_ad_set_id') or '').strip()
    ad_account_id = str(payload.get('ad_account_id') or payload.get('account_id') or '').strip()
    if not campaign_id and not adset_id and not ad_account_id:
        raise ToolValidationError('campaign_id, adset_id, or ad_account_id is required')

    out = connector_list_ads(
        token,
        account_id=ad_account_id,
        campaign_id=campaign_id,
        adset_id=adset_id,
        limit=int(payload.get('limit') or 50),
        after=str(payload.get('after') or ''),
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'Meta list ads failed')
    return {'ok': True, 'data': out.get('data') or [], 'paging': out.get('paging')}
