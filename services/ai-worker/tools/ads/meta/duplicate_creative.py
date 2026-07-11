"""Tool: duplicate Meta creative (reference duplicate_creative)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.meta_ads.duplication import duplicate_creative as connector_duplicate_creative
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')
    creative_id = payload.get('creative_id') or payload.get('platform_creative_id')
    if not creative_id:
        raise ToolValidationError('creative_id is required')
    out = connector_duplicate_creative(
        token,
        creative_id=str(creative_id),
        name_suffix=payload.get('name_suffix', ' - Copy'),
        new_primary_text=payload.get('new_primary_text'),
        new_headline=payload.get('new_headline'),
        new_description=payload.get('new_description'),
        new_cta_type=payload.get('new_cta_type'),
        new_destination_url=payload.get('new_destination_url'),
        new_creative_features_spec=payload.get('new_creative_features_spec'),
        pb_token=payload.get('pb_token'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'duplicate_creative failed')
    return out
