"""Tool: update Meta pixel (Graph POST /{pixel_id})."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from connectors.meta_ads.pixels import update_ad_pixel as connector_update_ad_pixel
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')

    pixel_id = payload.get('pixel_id') or payload.get('id')
    if not pixel_id:
        raise ToolValidationError('pixel_id is required')

    auto_fields = payload.get('automatic_matching_fields')
    if auto_fields is not None and not isinstance(auto_fields, list):
        raise ToolValidationError('automatic_matching_fields must be a list when provided')

    business_ids = payload.get('server_events_business_ids')
    if business_ids is not None and not isinstance(business_ids, list):
        raise ToolValidationError('server_events_business_ids must be a list when provided')

    enable_match = payload.get('enable_automatic_matching')
    if enable_match is not None and not isinstance(enable_match, bool):
        enable_match = str(enable_match).strip().lower() in ('1', 'true', 'yes')

    out = connector_update_ad_pixel(
        token,
        pixel_id=str(pixel_id),
        name=payload.get('name'),
        enable_automatic_matching=enable_match if enable_match is not None else None,
        data_use_setting=payload.get('data_use_setting'),
        first_party_cookie_status=payload.get('first_party_cookie_status'),
        automatic_matching_fields=_optional_str_list(auto_fields),
        server_events_business_ids=_optional_str_list(business_ids),
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'Meta update ad pixel failed')
    return out


def _optional_str_list(v: Any) -> Optional[List[str]]:
    if v is None:
        return None
    return [str(x) for x in v]
