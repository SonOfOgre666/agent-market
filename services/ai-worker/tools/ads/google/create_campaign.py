"""Tool: create Google Ads campaign chain — routes by campaign type."""

from __future__ import annotations

from typing import Any, Dict

from connectors.google_ads.api import GoogleAdsLibraryMissing, health_check
from connectors.google_ads.publish_router import publish_campaign_by_type
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    if not health_check():
        raise GoogleAdsLibraryMissing()

    gcfg = payload.get('google_ads_client_config') or payload.get('client_config')
    if not isinstance(gcfg, dict) or not gcfg:
        raise ToolValidationError('google_ads_client_config is required')

    customer_id = str(payload.get('customer_id') or payload.get('ad_account_id') or '').strip()
    if not customer_id:
        raise ToolValidationError('customer_id is required')

    name = (payload.get('name') or '').strip()
    if not name:
        raise ToolValidationError('name is required')

    try:
        return publish_campaign_by_type(
            google_ads_client_config=gcfg,
            customer_id=customer_id,
            payload=payload,
        )
    except ValueError as exc:
        raise ToolValidationError(str(exc)) from exc
