"""Tool: update Google ad group status (reference update_ad_group_status)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.google_ads import update_ad_group_status
from connectors.google_ads.utils import ad_group_resource_name
from tools.ads._errors import ToolValidationError
from tools.ads.google._config import require_google_config


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, customer_id = require_google_config(payload)
    ag_rn = (payload.get('ad_group_resource_name') or '').strip()
    if not ag_rn:
        ag_id = payload.get('platform_ad_set_id') or payload.get('ad_group_id')
        if not ag_id:
            raise ToolValidationError('ad_group_resource_name or platform_ad_set_id is required')
        ag_rn = ad_group_resource_name(customer_id, str(ag_id))

    status = (payload.get('status') or '').strip()
    if not status:
        raise ToolValidationError('status is required')

    out = update_ad_group_status(
        gcfg,
        customer_id=customer_id,
        ad_group_resource_name=ag_rn,
        status=status,
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'update ad group failed')
    return out
