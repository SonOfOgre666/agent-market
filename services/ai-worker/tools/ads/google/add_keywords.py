"""Tool: add keywords to a Google Ads ad group (reference create_keywords)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.google_ads.api import GoogleAdsLibraryMissing, digits_customer_id, health_check, load_client
from connectors.google_ads.keywords import add_keywords_to_ad_group
from connectors.google_ads.utils import ad_group_resource_name
from tools.ads._errors import ToolValidationError
from tools.ads._google_keywords import parse_keyword_payload
from tools.ads.google._config import require_google_config


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, customer_id = require_google_config(payload)

    ag_rn = payload.get('ad_group_resource_name')
    if not ag_rn:
        ag_id = (
            payload.get('platform_ad_set_id')
            or payload.get('platform_ad_group_id')
            or payload.get('ad_group_id')
        )
        if not ag_id:
            raise ToolValidationError('ad_group_resource_name or platform_ad_set_id is required')
        ag_rn = ad_group_resource_name(customer_id, str(ag_id))

    entries = parse_keyword_payload(payload)
    if not entries:
        raise ToolValidationError('keywords or keyword_entries is required')

    client = load_client(gcfg)
    out = add_keywords_to_ad_group(
        client,
        customer_id,
        ad_group_resource_name=str(ag_rn),
        keyword_entries=entries,
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'add keywords failed')
    return out
