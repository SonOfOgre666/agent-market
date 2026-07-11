"""Tool: list Google campaign budgets (reference list_budgets)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.google_ads.budgets import list_campaign_budgets
from tools.ads.google._config import require_google_config


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, customer_id = require_google_config(payload)
    return list_campaign_budgets(gcfg, customer_id=customer_id, limit=int(payload.get('limit') or 50))
