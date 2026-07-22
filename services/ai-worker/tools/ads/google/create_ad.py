"""Tool: create Google responsive search ad in an existing ad group."""

from __future__ import annotations

from typing import Any, Dict, List

from connectors.google_ads.ads import create_responsive_search_ad
from connectors.google_ads.api import GoogleAdsLibraryMissing, health_check, load_client
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    if not health_check():
        raise GoogleAdsLibraryMissing()

    gcfg = payload.get('google_ads_client_config') or payload.get('client_config')
    if not isinstance(gcfg, dict) or not gcfg:
        raise ToolValidationError('google_ads_client_config is required')

    customer_id = str(payload.get('customer_id') or '').strip()
    ad_group_rn = payload.get('ad_group_resource_name')
    if not ad_group_rn and payload.get('platform_ad_set_id') and customer_id:
        ad_group_rn = f'customers/{customer_id}/adGroups/{payload["platform_ad_set_id"]}'
    if not ad_group_rn:
        ag_id = payload.get('platform_ad_group_id')
        if ag_id and customer_id:
            ad_group_rn = f'customers/{customer_id}/adGroups/{ag_id}'
    if not customer_id or not ad_group_rn:
        raise ToolValidationError('customer_id and ad_group_resource_name (or platform_ad_set_id) are required')

    creatives = dict(payload.get('creatives') or {})
    headlines: List[str] = list(payload.get('headlines') or creatives.get('headlines') or [])
    descriptions: List[str] = list(payload.get('descriptions') or creatives.get('descriptions') or [])
    final_url = (payload.get('final_url') or creatives.get('link_url') or '').strip()
    path1 = str(payload.get('path1') or creatives.get('path1') or '')
    path2 = str(payload.get('path2') or creatives.get('path2') or '')

    client = load_client(gcfg)
    out = create_responsive_search_ad(
        client,
        customer_id,
        ad_group_resource_name=str(ad_group_rn),
        headlines=headlines,
        descriptions=descriptions,
        final_url=final_url,
        path1=path1,
        path2=path2,
        status=str(payload.get('status') or creatives.get('ad_status') or 'PAUSED'),
    )
    if out.get('skipped'):
        raise ToolValidationError(out.get('reason') or 'RSA requirements not met')
    return {'ok': True, **out}
