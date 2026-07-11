"""Tool: Google Ads customer profile (reference get_account_info; meta_get_account parity)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.google_ads.accounts import fetch_customer_info
from tools.ads.google._config import require_google_config


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, customer_id = require_google_config(payload)
    return fetch_customer_info(gcfg, customer_id=customer_id)
