"""Tool: update Meta ad set (reference update_adset)."""

from __future__ import annotations

from typing import Any, Dict, Optional

from connectors.meta_ads import update_adset as connector_update_adset
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')

    adset_id = payload.get('adset_id') or payload.get('ad_set_id') or payload.get('platform_ad_set_id')
    if not adset_id:
        raise ToolValidationError('adset_id is required')

    targeting = payload.get('targeting')
    if targeting is not None and not isinstance(targeting, dict):
        raise ToolValidationError('targeting must be an object when provided')

    multi_adv = payload.get('multi_advertiser_ads')
    if multi_adv is not None:
        try:
            multi_adv = int(multi_adv)
        except (TypeError, ValueError):
            multi_adv = None

    out = connector_update_adset(
        token,
        adset_id=str(adset_id),
        frequency_control_specs=payload.get('frequency_control_specs'),
        bid_strategy=payload.get('bid_strategy'),
        bid_amount=_optional_int(payload.get('bid_amount')),
        bid_constraints=payload.get('bid_constraints'),
        bid_adjustments=payload.get('bid_adjustments'),
        name=payload.get('name'),
        status=payload.get('status'),
        targeting=targeting,
        optimization_goal=payload.get('optimization_goal'),
        daily_budget=_optional_int(payload.get('daily_budget')),
        lifetime_budget=_optional_int(payload.get('lifetime_budget')),
        is_dynamic_creative=payload.get('is_dynamic_creative'),
        start_time=payload.get('start_time'),
        end_time=payload.get('end_time'),
        dsa_beneficiary=payload.get('dsa_beneficiary'),
        dsa_payor=payload.get('dsa_payor'),
        multi_advertiser_ads=multi_adv,
        regional_regulated_categories=payload.get('regional_regulated_categories'),
        regional_regulation_identities=payload.get('regional_regulation_identities'),
        attribution_spec=payload.get('attribution_spec'),
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'Meta update ad set failed')
    return out


def _optional_int(v: Any) -> Optional[int]:
    if v is None or v == '':
        return None
    return int(v)
