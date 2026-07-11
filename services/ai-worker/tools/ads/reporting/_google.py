"""Shared Google Ads reporting tool helpers."""

from __future__ import annotations

from typing import Any, Dict

from connectors.google_ads.api import GoogleAdsException, GoogleAdsLibraryMissing, digits_customer_id, health_check
from connectors.google_ads.reporting import run_google_ads_reporting
from tools.ads._errors import ToolValidationError


def run_google_operation(operation: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    if not health_check():
        raise GoogleAdsLibraryMissing()
    gcfg = payload.get('google_ads_client_config')
    if not isinstance(gcfg, dict) or not gcfg.get('refresh_token'):
        raise ToolValidationError(
            'google_ads_client_config is required (provide account_id for auto-resolve)',
        )
    cid = digits_customer_id(payload.get('customer_id'))
    if not cid:
        raise ToolValidationError('customer_id is required')
    try:
        out = run_google_ads_reporting(gcfg, cid, operation, payload)
    except GoogleAdsException as exc:
        parts = []
        failure = getattr(exc, 'failure', None)
        for err in getattr(failure, 'errors', []) or []:
            parts.append(getattr(err, 'message', str(err)))
        raise ToolValidationError(parts[0] if parts else str(exc)) from exc
    return {'ok': True, **out}
