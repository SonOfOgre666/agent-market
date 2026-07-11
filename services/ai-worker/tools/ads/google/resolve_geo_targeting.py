"""Tool: resolve natural-language geo intent to Google geo_target_constant IDs."""

from __future__ import annotations

from typing import Any, Dict, List

from connectors.google_ads.geo_resolve import resolve_geo_targeting_intent as connector_resolve
from lib.planner.geo_targeting_intent import GeoTargetingIntent
from tools.ads._errors import ToolValidationError
from tools.ads.google._config import require_google_config


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, customer_id = require_google_config(payload)
    intent = GeoTargetingIntent.from_payload(payload)
    if not intent:
        raw_locations = payload.get('locations')
        if not isinstance(raw_locations, list) or not raw_locations:
            raise ToolValidationError('locations or include/exclude geo intent is required')
    else:
        raw_locations = None

    out = connector_resolve(
        gcfg,
        customer_id=customer_id,
        intent=intent,
        locations=raw_locations if isinstance(raw_locations, list) else None,
        locale=str(payload.get('locale') or 'en'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'resolve geo targeting failed')
    return out
