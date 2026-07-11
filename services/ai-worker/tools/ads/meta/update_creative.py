"""Tool: update Meta creative (reference update_ad_creative)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.meta_ads import update_ad_creative as connector_update_ad_creative
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')

    creative_id = payload.get('creative_id') or payload.get('platform_creative_id')
    if not creative_id:
        raise ToolValidationError('creative_id is required')

    out = connector_update_ad_creative(
        token,
        creative_id=str(creative_id),
        name=payload.get('name'),
        message=payload.get('message'),
        messages=payload.get('messages'),
        headline=payload.get('headline'),
        headlines=payload.get('headlines'),
        description=payload.get('description'),
        descriptions=payload.get('descriptions'),
        optimization_type=payload.get('optimization_type'),
        dynamic_creative_spec=payload.get('dynamic_creative_spec'),
        call_to_action_type=payload.get('call_to_action_type'),
        lead_gen_form_id=payload.get('lead_gen_form_id'),
        ad_formats=payload.get('ad_formats'),
        creative_features_spec=payload.get('creative_features_spec'),
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'Meta update creative failed')
    return out
