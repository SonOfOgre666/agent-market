"""Tool: create Google ad group (reference create_ad_group)."""

from __future__ import annotations

from typing import Any, Dict, Optional

from connectors.google_ads.adgroups import create_ad_group
from connectors.google_ads.api import load_client
from connectors.google_ads.utils import campaign_resource_name
from tools.ads._errors import ToolValidationError
from tools.ads.google._config import require_google_config


def _cpc_micros(payload: Dict[str, Any]) -> Optional[int]:
    if payload.get('cpc_bid_micros') is not None:
        try:
            return int(payload['cpc_bid_micros'])
        except (TypeError, ValueError):
            return None
    if payload.get('cpc_bid') is not None:
        try:
            return int(round(float(payload['cpc_bid']) * 1_000_000))
        except (TypeError, ValueError):
            return None
    return None


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, customer_id = require_google_config(payload)

    name = (payload.get('name') or '').strip()
    if not name:
        raise ToolValidationError('name is required')

    camp_rn = payload.get('campaign_resource_name')
    if not camp_rn:
        platform_campaign_id = payload.get('platform_campaign_id') or payload.get('campaign_id')
        if not platform_campaign_id:
            raise ToolValidationError('campaign_resource_name or platform_campaign_id is required')
        camp_rn = campaign_resource_name(customer_id, str(platform_campaign_id))

    channel = str(payload.get('type') or payload.get('channel') or 'search').lower()
    status = str(payload.get('status') or payload.get('adgroup_status') or 'PAUSED').upper()

    client = load_client(gcfg)
    out = create_ad_group(
        client,
        customer_id,
        campaign_resource_name=str(camp_rn),
        name=name,
        channel=channel,
        status=status,
        cpc_bid_micros=_cpc_micros(payload),
    )
    return {
        'ok': True,
        'platform_ad_set_id': out.get('platform_ad_set_id'),
        'ad_group_resource_name': out.get('ad_group_resource_name'),
        'status': out.get('status'),
        'cpc_bid_micros': out.get('cpc_bid_micros'),
        'customer_id': customer_id,
        'name': name,
    }
