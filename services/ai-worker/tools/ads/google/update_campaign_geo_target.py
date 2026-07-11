"""Tool: update Google campaign geo target type (reference update_campaign_geo_target_type)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.google_ads import update_campaign_geo_target_type
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

    out = update_campaign_geo_target_type(
        gcfg,
        customer_id=customer_id,
        campaign_resource_name=camp_rn,
        positive_geo_target_type=payload.get('positive_geo_target_type'),
        negative_geo_target_type=payload.get('negative_geo_target_type'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'update geo target type failed')
    return out
