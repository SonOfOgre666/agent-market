"""Shared Meta Ads reporting tool helpers."""

from __future__ import annotations

from typing import Any, Dict, Tuple

from connectors.meta_ads.reporting import run_meta_ads_reporting
from tools.ads._errors import ToolValidationError


def _meta_credentials(payload: Dict[str, Any]) -> Tuple[str, str]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required (provide account_id for auto-resolve)')
    api_version = str(payload.get('api_version') or 'v22.0')
    return token, api_version


def run_meta_operation(operation: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    token, api_version = _meta_credentials(payload)
    result = run_meta_ads_reporting(token, api_version, operation, payload)
    return {'ok': True, 'result': result}
