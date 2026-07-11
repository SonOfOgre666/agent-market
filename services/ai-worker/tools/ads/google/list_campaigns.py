"""Tool: list Google Ads campaigns (sync read)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.google_ads import list_campaigns as connector_list_campaigns
from tools.ads._errors import ToolValidationError
from tools.ads.google._config import require_google_config


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, customer_id = require_google_config(payload)
    limit = int(payload.get('limit') or 50)
    out = connector_list_campaigns(gcfg, customer_id=customer_id, limit=limit)
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'list campaigns failed')
    return {'ok': True, 'data': out.get('data') or [], 'count': out.get('count', 0)}
