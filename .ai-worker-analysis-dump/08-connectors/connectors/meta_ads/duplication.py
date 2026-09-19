"""Meta Ads duplication — reference_ads/meta_ads/duplication.py (Pipeboard forward API, no MCP)."""

from __future__ import annotations

import os
from typing import Any, Dict, Optional

import httpx

from .api import format_graph_error


def duplication_enabled() -> bool:
    return bool(os.environ.get('META_ADS_ENABLE_DUPLICATION', '').strip())


def _forward_duplication(
    access_token: str,
    resource_type: str,
    resource_id: str,
    options: Dict[str, Any],
) -> Dict[str, Any]:
    pipeboard_token = (
        options.pop('pb_token', None)
        or os.environ.get('PIPEBOARD_API_TOKEN', '').strip()
        or os.environ.get('META_ADS_PIPEBOARD_TOKEN', '').strip()
    )
    if not pipeboard_token:
        return {
            'ok': False,
            'error': 'Pipeboard API token required for duplication',
            'details': 'Set PIPEBOARD_API_TOKEN or pass pb_token in payload',
        }
    if not access_token:
        return {'ok': False, 'error': 'access_token is required for duplication'}

    base_url = os.environ.get('PIPEBOARD_API_BASE_URL', 'https://mcp.pipeboard.co').rstrip('/')
    endpoint = f'{base_url}/api/meta/duplicate/{resource_type}/{resource_id}'
    headers = {
        'Authorization': f'Bearer {access_token}',
        'X-Pipeboard-Token': pipeboard_token,
        'Content-Type': 'application/json',
        'User-Agent': 'agent-market-meta-ads/1.0',
    }
    clean_options = {k: v for k, v in options.items() if v is not None}

    try:
        resp = httpx.post(endpoint, headers=headers, json=clean_options, timeout=120.0)
    except Exception as exc:
        return {'ok': False, 'error': 'Duplication request failed', 'details': str(exc)}

    try:
        body = resp.json()
    except Exception:
        body = {'raw': resp.text}

    if resp.status_code == 200:
        return {'ok': True, **body} if isinstance(body, dict) else {'ok': True, 'result': body}
    if resp.status_code == 400:
        return {
            'ok': False,
            'error': 'validation_failed',
            'errors': body.get('errors', [resp.text]) if isinstance(body, dict) else [resp.text],
            'warnings': body.get('warnings', []) if isinstance(body, dict) else [],
        }
    if resp.status_code == 429:
        return {'ok': False, 'error': 'rate_limit', 'details': body}
    return {
        'ok': False,
        'error': format_graph_error(body.get('error', body)) if isinstance(body, dict) else resp.text,
        'status_code': resp.status_code,
    }


def duplicate_campaign(
    access_token: str,
    *,
    campaign_id: str,
    name_suffix: str = ' - Copy',
    include_ad_sets: bool = True,
    include_ads: bool = True,
    include_creatives: bool = True,
    copy_schedule: bool = False,
    new_daily_budget: Optional[float] = None,
    new_start_time: Optional[str] = None,
    new_end_time: Optional[str] = None,
    new_status: str = 'PAUSED',
    pb_token: Optional[str] = None,
) -> Dict[str, Any]:
    if not duplication_enabled():
        return {'ok': False, 'error': 'Duplication disabled — set META_ADS_ENABLE_DUPLICATION=1'}
    return _forward_duplication(
        access_token,
        'campaign',
        campaign_id,
        {
            'name_suffix': name_suffix,
            'include_ad_sets': include_ad_sets,
            'include_ads': include_ads,
            'include_creatives': include_creatives,
            'copy_schedule': copy_schedule,
            'new_daily_budget': new_daily_budget,
            'new_start_time': new_start_time,
            'new_end_time': new_end_time,
            'new_status': new_status,
            'pb_token': pb_token,
        },
    )


def duplicate_adset(
    access_token: str,
    *,
    adset_id: str,
    target_campaign_id: Optional[str] = None,
    name_suffix: str = ' - Copy',
    include_ads: bool = True,
    include_creatives: bool = True,
    new_daily_budget: Optional[float] = None,
    new_targeting: Optional[Dict[str, Any]] = None,
    new_start_time: Optional[str] = None,
    new_end_time: Optional[str] = None,
    new_status: str = 'PAUSED',
    pb_token: Optional[str] = None,
) -> Dict[str, Any]:
    if not duplication_enabled():
        return {'ok': False, 'error': 'Duplication disabled — set META_ADS_ENABLE_DUPLICATION=1'}
    return _forward_duplication(
        access_token,
        'adset',
        adset_id,
        {
            'target_campaign_id': str(target_campaign_id) if target_campaign_id else None,
            'name_suffix': name_suffix,
            'include_ads': include_ads,
            'include_creatives': include_creatives,
            'new_daily_budget': new_daily_budget,
            'new_targeting': new_targeting,
            'new_start_time': new_start_time,
            'new_end_time': new_end_time,
            'new_status': new_status,
            'pb_token': pb_token,
        },
    )


def duplicate_ad(
    access_token: str,
    *,
    ad_id: str,
    target_adset_id: Optional[str] = None,
    name_suffix: str = ' - Copy',
    duplicate_creative: bool = True,
    new_creative_name: Optional[str] = None,
    new_status: str = 'PAUSED',
    pb_token: Optional[str] = None,
) -> Dict[str, Any]:
    if not duplication_enabled():
        return {'ok': False, 'error': 'Duplication disabled — set META_ADS_ENABLE_DUPLICATION=1'}
    return _forward_duplication(
        access_token,
        'ad',
        ad_id,
        {
            'target_adset_id': str(target_adset_id) if target_adset_id else None,
            'name_suffix': name_suffix,
            'duplicate_creative': duplicate_creative,
            'new_creative_name': new_creative_name,
            'new_status': new_status,
            'pb_token': pb_token,
        },
    )


def duplicate_creative(
    access_token: str,
    *,
    creative_id: str,
    name_suffix: str = ' - Copy',
    new_primary_text: Optional[str] = None,
    new_headline: Optional[str] = None,
    new_description: Optional[str] = None,
    new_cta_type: Optional[str] = None,
    new_destination_url: Optional[str] = None,
    new_creative_features_spec: Optional[Dict[str, Any]] = None,
    pb_token: Optional[str] = None,
) -> Dict[str, Any]:
    if not duplication_enabled():
        return {'ok': False, 'error': 'Duplication disabled — set META_ADS_ENABLE_DUPLICATION=1'}
    return _forward_duplication(
        access_token,
        'creative',
        creative_id,
        {
            'name_suffix': name_suffix,
            'new_primary_text': new_primary_text,
            'new_headline': new_headline,
            'new_description': new_description,
            'new_cta_type': new_cta_type,
            'new_destination_url': new_destination_url,
            'new_creative_features_spec': new_creative_features_spec,
            'pb_token': pb_token,
        },
    )
