"""Tool: resolve natural-language geo intent to Meta geo_locations payloads."""

from __future__ import annotations

from typing import Any, Dict

from connectors.meta_ads.geo_resolve import resolve_geo_targeting_intent as connector_resolve
from lib.planner.geo_targeting_intent import GeoTargetingIntent
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')
    intent = GeoTargetingIntent.from_payload(payload)
    raw_locations = payload.get('locations')
    if not intent and (not isinstance(raw_locations, list) or not raw_locations):
        raise ToolValidationError('locations or include/exclude geo intent is required')

    out = connector_resolve(
        token,
        intent=intent,
        locations=raw_locations if isinstance(raw_locations, list) else None,
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'resolve geo targeting failed')
    return out
