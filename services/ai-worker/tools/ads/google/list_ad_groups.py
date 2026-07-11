"""Tool: list Google ad groups (meta_list_adsets parity)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.google_ads.adgroups import list_ad_groups as connector_list_ad_groups
from tools.ads._errors import ToolValidationError
from tools.ads.google._config import require_google_config


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, customer_id = require_google_config(payload)
    out = connector_list_ad_groups(
        gcfg,
        customer_id=customer_id,
        campaign_id=payload.get('platform_campaign_id') or payload.get('campaign_id'),
        status=payload.get('status'),
        limit=int(payload.get('limit') or 100),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'list ad groups failed')
    return {'ok': True, 'data': out.get('data') or [], 'count': out.get('count', 0)}
