"""Shared Google Ads tool payload helpers."""

from __future__ import annotations

from typing import Any, Dict, Tuple

from connectors.google_ads.api import GoogleAdsLibraryMissing, digits_customer_id, health_check
from tools.ads._errors import ToolValidationError


def require_google_config(payload: Dict[str, Any]) -> Tuple[Dict[str, Any], str]:
    if not health_check():
        raise GoogleAdsLibraryMissing()
    gcfg = payload.get('google_ads_client_config') or payload.get('client_config')
    if not isinstance(gcfg, dict) or not gcfg:
        raise ToolValidationError('google_ads_client_config is required')
    customer_id = digits_customer_id(payload.get('customer_id') or payload.get('ad_account_id'))
    if not customer_id:
        raise ToolValidationError('customer_id is required')
    return gcfg, customer_id
