"""Shared helpers for type-specific Google publish tool wrappers."""

from __future__ import annotations

from typing import Any, Callable, Dict

from connectors.google_ads.api import GoogleAdsLibraryMissing, health_check
from tools.ads._errors import ToolValidationError


def run_typed_publish(
    payload: Dict[str, Any],
    *,
    publisher: Callable[..., Dict[str, Any]],
    default_type: str | None = None,
) -> Dict[str, Any]:
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

    from tools.ads.google._media_file import resolve_creative_media
    from tools.ads._budget_currency import convert_payload_budget

    body = dict(payload)
    if default_type and not body.get('type') and not body.get('campaign_type'):
        body['type'] = default_type
    body, _conversion = convert_payload_budget(body, platform='google')
    body = resolve_creative_media(body)

    try:
        return publisher(
            google_ads_client_config=gcfg,
            customer_id=customer_id,
            payload=body,
        )
    except ValueError as exc:
        raise ToolValidationError(str(exc)) from exc
