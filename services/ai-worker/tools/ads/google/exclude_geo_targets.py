"""Tool: exclude geo locations from a Google campaign (reference exclude_geo_targets)."""

from __future__ import annotations

from typing import Any, Dict, List

from connectors.google_ads import exclude_geo_targets
from connectors.google_ads.criteria import resolve_campaign_resource_name
from tools.ads._errors import ToolValidationError
from tools.ads.google._config import require_google_config


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, customer_id = require_google_config(payload)
    camp_rn = resolve_campaign_resource_name(
        gcfg,
        customer_id,
        payload.get('campaign_resource_name'),
        payload.get('platform_campaign_id') or payload.get('campaign_id'),
    )
    if not camp_rn:
        raise ToolValidationError('campaign_resource_name or platform_campaign_id is required')

    raw_ids: List[Any] = list(
        payload.get('geo_target_constant_ids')
        or payload.get('location_ids')
        or payload.get('geo_ids')
        or []
    )
    if not raw_ids:
        raise ToolValidationError('geo_target_constant_ids is required')

    out = exclude_geo_targets(
        gcfg,
        customer_id=customer_id,
        campaign_resource_name=camp_rn,
        geo_target_constant_ids=[int(x) for x in raw_ids],
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'exclude geo targets failed')
    return out
