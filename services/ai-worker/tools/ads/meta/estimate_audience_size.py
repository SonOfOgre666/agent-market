"""Tool: estimate Meta audience size (reference estimate_audience_size)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.meta_ads.targeting_search import estimate_audience_size as connector_estimate_audience_size
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')
    out = connector_estimate_audience_size(
        token,
        account_id=payload.get('ad_account_id') or payload.get('account_id'),
        targeting=payload.get('targeting') or payload.get('targeting_spec'),
        optimization_goal=str(payload.get('optimization_goal') or 'REACH'),
        interest_list=payload.get('interest_list'),
        interest_fbid_list=payload.get('interest_fbid_list'),
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'estimate_audience_size failed')
    return out
