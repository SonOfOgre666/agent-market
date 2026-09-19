"""Full Search campaign publish (budget → campaign → ad group → keywords → RSA)."""

from __future__ import annotations

from typing import Any, Dict

from .api import load_client
from .campaigns import mutate_create_paused_campaign
from .keywords import normalize_keyword_entries
from .publish_common import apply_geo_targeting_if_present


def publish_search_campaign(
    *,
    google_ads_client_config: Dict[str, Any],
    customer_id: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    client = load_client(google_ads_client_config)
    name = (payload.get('name') or 'Campaign').strip()
    creatives = dict(payload.get('creatives') or {})
    entries = normalize_keyword_entries(
        payload.get('keyword_entries') or payload.get('keywords') or [],
    )
    keywords = list(payload.get('keywords') or [])
    result = mutate_create_paused_campaign(
        client,
        customer_id,
        name,
        payload.get('budget'),
        payload.get('start_date'),
        payload.get('end_date'),
        keywords or [e['text'] for e in entries],
        payload.get('type') or payload.get('campaign_type') or 'search',
        creatives,
        keyword_entries=entries or None,
        adgroup_status=str(payload.get('adgroup_status') or 'PAUSED'),
        cpc_bid_micros=payload.get('cpc_bid_micros'),
        schedule_timezone=payload.get('schedule_timezone'),
    )
    camp_id = result.get('platform_campaign_id')
    if camp_id:
        camp_rn = f'customers/{customer_id}/campaigns/{camp_id}'
        apply_geo_targeting_if_present(
            google_ads_client_config,
            customer_id=customer_id,
            campaign_resource_name=camp_rn,
            payload=payload,
        )
    return {'ok': True, **result, 'campaign_type': 'search'}
