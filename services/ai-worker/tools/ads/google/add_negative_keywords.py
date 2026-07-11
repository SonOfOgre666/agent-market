"""Tool: add campaign-level negative keywords (reference create_negative_campaign_keywords)."""

from __future__ import annotations

from typing import Any, Dict, List

from connectors.google_ads import create_negative_campaign_keywords
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

    raw_kw: List[str] = list(payload.get('keywords') or [])
    if isinstance(payload.get('keywords'), str):
        raw_kw = [k.strip() for k in str(payload['keywords']).split(',') if k.strip()]
    if not raw_kw:
        raise ToolValidationError('keywords is required')

    out = create_negative_campaign_keywords(
        gcfg,
        customer_id=customer_id,
        campaign_resource_name=camp_rn,
        keywords=raw_kw,
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'add negative keywords failed')
    return out
