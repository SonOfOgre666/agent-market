"""Tool: list Google Ads accounts accessible to connected credentials."""

from __future__ import annotations

from typing import Any, Dict

from connectors.google_ads.accounts import fetch_accessible_accounts
from connectors.google_ads.api import GoogleAdsLibraryMissing, health_check
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    if not health_check():
        raise GoogleAdsLibraryMissing()

    gcfg = payload.get('google_ads_client_config') or payload.get('client_config')
    if not isinstance(gcfg, dict) or not gcfg:
        raise ToolValidationError('google_ads_client_config is required')

    out = fetch_accessible_accounts(gcfg)
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'Google ad accounts request failed')
    return out
