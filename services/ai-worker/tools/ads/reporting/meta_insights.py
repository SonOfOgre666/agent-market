"""Tool: Meta Ads insights (reference get_insights)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.meta_ads.insights import get_insights as connector_get_insights
from tools.ads._errors import ToolValidationError


def _resolve_object_id(payload: Dict[str, Any]) -> str:
    for key in (
        'object_id',
        'account_id',
        'ad_account_id',
        'campaign_id',
        'platform_campaign_id',
        'adset_id',
        'ad_set_id',
        'platform_ad_set_id',
        'ad_id',
        'platform_ad_id',
    ):
        val = (payload.get(key) or '').strip()
        if val:
            return val
    return ''


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')

    oid = _resolve_object_id(payload)
    if not oid:
        raise ToolValidationError(
            'object_id is required (or account_id, campaign_id, adset_id, ad_id)',
        )

    out = connector_get_insights(
        token,
        object_id=oid,
        time_range=payload.get('time_range') or payload.get('date_preset') or 'maximum',
        breakdown=str(payload.get('breakdown') or ''),
        level=str(payload.get('level') or 'ad'),
        limit=int(payload.get('limit') or 25),
        after=str(payload.get('after') or ''),
        action_attribution_windows=payload.get('action_attribution_windows'),
        action_breakdowns=payload.get('action_breakdowns'),
        compact=bool(payload.get('compact', False)),
        account_id=str(payload.get('account_id') or payload.get('ad_account_id') or ''),
        campaign_id=str(payload.get('campaign_id') or payload.get('platform_campaign_id') or ''),
        adset_id=str(
            payload.get('adset_id') or payload.get('ad_set_id') or payload.get('platform_ad_set_id') or '',
        ),
        ad_id=str(payload.get('ad_id') or payload.get('platform_ad_id') or ''),
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'Meta insights failed')
    return out
