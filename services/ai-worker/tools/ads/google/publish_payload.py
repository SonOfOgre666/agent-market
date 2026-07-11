"""Build Google Ads publish payloads from Mongo campaign docs."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from connectors.google_ads.keywords import normalize_keyword_entries


def build_google_publish_payload(campaign: Dict[str, Any], account: Dict[str, Any]) -> Dict[str, Any]:
    """Normalized payload for ``google_create_campaign``."""
    account_id = campaign.get('account_id')
    if account_id is not None:
        account_id = str(account_id)

    targeting = _targeting_dict(campaign)
    schedule_tz = (
        campaign.get('schedule_timezone')
        or targeting.get('schedule_timezone')
        or (account.get('data') or {}).get('time_zone')
    )
    entries = keyword_entries(campaign)
    flat_kw = list(campaign.get('keywords') or [])
    if not flat_kw and entries:
        flat_kw = [e['text'] for e in entries]

    creatives = dict(campaign.get('creatives') or {})
    geo_ids = geo_target_constant_ids(campaign)
    ctype = str(campaign.get('type') or 'search').strip().lower()

    payload: Dict[str, Any] = {
        'account_id': account_id,
        'name': (campaign.get('name') or 'Campaign').strip(),
        'budget': campaign.get('budget'),
        'start_date': campaign.get('start_date'),
        'end_date': campaign.get('end_date'),
        'keywords': flat_kw,
        'keyword_entries': entries,
        'type': ctype or 'search',
        'creatives': creatives,
        'adgroup_status': adgroup_status(campaign),
        'cpc_bid_micros': adgroup_cpc_bid_micros(campaign),
        'schedule_timezone': str(schedule_tz).strip() if schedule_tz else None,
        'targeting': targeting,
    }
    if geo_ids:
        payload['geo_target_constant_ids'] = geo_ids

    shopping = targeting.get('shopping') if isinstance(targeting.get('shopping'), dict) else {}
    if ctype == 'shopping':
        payload['merchant_id'] = (
            campaign.get('merchant_id')
            or creatives.get('merchant_id')
            or targeting.get('merchant_id')
            or shopping.get('merchant_id')
        )
        feed = (
            campaign.get('feed_label')
            or targeting.get('feed_label')
            or shopping.get('feed_label')
            or campaign.get('sales_country')
            or targeting.get('sales_country')
            or shopping.get('sales_country')
        )
        if feed:
            payload['feed_label'] = str(feed).strip()
    if ctype == 'app':
        payload['app_id'] = campaign.get('app_id') or creatives.get('app_id') or targeting.get('app_id')
        payload['app_store'] = (
            campaign.get('app_store') or creatives.get('app_store') or targeting.get('app_store') or 'GOOGLE_APP_STORE'
        )
        payload['advertising_channel_sub_type'] = campaign.get('advertising_channel_sub_type') or 'APP_CAMPAIGN'
    if ctype == 'video':
        payload['youtube_video_id'] = (
            creatives.get('youtube_video_id') or campaign.get('youtube_video_id') or targeting.get('youtube_video_id')
        )
        payload['youtube_url'] = creatives.get('youtube_url') or campaign.get('youtube_url') or targeting.get('youtube_url')
        payload['advertising_channel_sub_type'] = campaign.get('advertising_channel_sub_type') or 'VIDEO_ACTION'
    if ctype in ('app', 'video') and campaign.get('target_cpa_micros'):
        payload['target_cpa_micros'] = campaign.get('target_cpa_micros')
    elif ctype in ('app', 'video') and targeting.get('target_cpa_micros'):
        payload['target_cpa_micros'] = targeting.get('target_cpa_micros')
    if ctype == 'performance_max' and (campaign.get('merchant_id') or targeting.get('merchant_id')):
        payload['merchant_id'] = campaign.get('merchant_id') or targeting.get('merchant_id')

    return payload


def keyword_entries(campaign: Dict[str, Any]) -> List[Dict[str, str]]:
    targeting = _targeting_dict(campaign)
    raw = targeting.get('keyword_entries')
    if isinstance(raw, list) and raw:
        return normalize_keyword_entries(raw)
    return normalize_keyword_entries(list(campaign.get('keywords') or []))


def adgroup_status(campaign: Dict[str, Any]) -> str:
    targeting = _targeting_dict(campaign)
    return str(targeting.get('adgroup_status') or targeting.get('ad_group_status') or 'PAUSED').upper()


def adgroup_cpc_bid_micros(campaign: Dict[str, Any]) -> Optional[int]:
    targeting = _targeting_dict(campaign)
    if targeting.get('cpc_bid_micros') is not None:
        try:
            return int(targeting['cpc_bid_micros'])
        except (TypeError, ValueError):
            pass
    if targeting.get('cpc_bid') is not None:
        try:
            return int(round(float(targeting['cpc_bid']) * 1_000_000))
        except (TypeError, ValueError):
            pass
    return None


def _targeting_dict(campaign: Dict[str, Any]) -> Dict[str, Any]:
    t = campaign.get('targeting')
    return dict(t) if isinstance(t, dict) else {}


def geo_target_constant_ids(campaign: Dict[str, Any]) -> List[int]:
    targeting = _targeting_dict(campaign)
    raw = targeting.get('geo_target_constant_ids') or targeting.get('geo_ids') or []
    if not isinstance(raw, list):
        return []
    out: List[int] = []
    for x in raw:
        try:
            out.append(int(x))
        except (TypeError, ValueError):
            continue
    return out


def excluded_geo_target_constant_ids(campaign: Dict[str, Any]) -> List[int]:
    targeting = _targeting_dict(campaign)
    raw = (
        targeting.get('excluded_geo_target_constant_ids')
        or targeting.get('geo_exclude_ids')
        or []
    )
    if not isinstance(raw, list):
        return []
    out: List[int] = []
    for x in raw:
        try:
            out.append(int(x))
        except (TypeError, ValueError):
            continue
    return out


def negative_keywords(campaign: Dict[str, Any]) -> List[str]:
    targeting = _targeting_dict(campaign)
    raw = targeting.get('negative_keywords') or []
    if isinstance(raw, str):
        return [k.strip() for k in raw.replace('\n', ',').split(',') if k.strip()]
    if isinstance(raw, list):
        return [str(k).strip() for k in raw if str(k).strip()]
    return list(campaign.get('negative_keywords') or [])
