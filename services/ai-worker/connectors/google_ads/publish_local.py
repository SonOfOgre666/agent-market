"""Local campaigns route to Performance Max (Google deprecated standalone LOCAL creation)."""

from __future__ import annotations

from typing import Any, Dict

from .publish_performance_max import publish_performance_max_campaign


def publish_local_campaign(
    *,
    google_ads_client_config: Dict[str, Any],
    customer_id: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Standalone LOCAL channel campaigns were auto-upgraded to Performance Max (2022+).
    Route local publish requests through the PMax chain with local-oriented defaults.
    """
    merged = dict(payload)
    merged['type'] = 'performance_max'
    merged['_routed_from'] = 'local'
    if not merged.get('name'):
        merged['name'] = 'Local Performance Max Campaign'

    out = publish_performance_max_campaign(
        google_ads_client_config=google_ads_client_config,
        customer_id=customer_id,
        payload=merged,
    )
    return {
        **out,
        'campaign_type': 'local',
        'routed_to': 'performance_max',
        'deprecation_note': (
            'LOCAL channel creation is deprecated by Google; published as Performance Max. '
            'See https://developers.google.com/google-ads/api/performance-max/upgrade-eligibility'
        ),
    }
