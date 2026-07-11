"""
Build ``meta_publish_campaign`` tool payloads from Mongo campaign docs.

Rules mirror reference_ads/meta_ads/ (campaign → ad set → creative → ad).
Used by UI publish (tasks.ads.publish_campaign) and agents (same tool_id).
"""

from __future__ import annotations

from typing import Any, Dict


def build_meta_publish_payload(campaign: Dict[str, Any], account: Dict[str, Any]) -> Dict[str, Any]:
    """Normalized payload for ``meta_publish_campaign`` / ``run_ads_tool``."""
    creatives = dict(campaign.get('creatives') or {})
    targeting = dict(campaign.get('targeting') or {})
    name = (campaign.get('name') or 'Campaign').strip()
    account_data = account.get('data') or {}

    targeting.setdefault('adset_name', targeting.get('name') or f'{name} — Ad Set')
    targeting.setdefault('optimization_goal', 'LINK_CLICKS')
    targeting.setdefault('billing_event', 'IMPRESSIONS')

    page_id = (
        creatives.get('page_id')
        or account_data.get('page_id')
        or account_data.get('facebook_page_id')
    )

    account_id = campaign.get('account_id')
    if account_id is not None:
        account_id = str(account_id)

    ad_account_id = campaign.get('ad_account_id') or account_data.get('ad_account_id')

    if not creatives.get('message') and creatives.get('headlines'):
        h = creatives['headlines']
        if isinstance(h, list) and h:
            creatives.setdefault('message', h[0] if isinstance(h[0], str) else str(h[0]))

    promoted_object = campaign.get('promoted_object')
    if not promoted_object and isinstance(targeting.get('promoted_object'), dict):
        promoted_object = targeting.get('promoted_object')

    return {
        'account_id': account_id,
        'ad_account_id': str(ad_account_id) if ad_account_id else None,
        'name': name,
        'objective': campaign.get('objective') or campaign.get('goal'),
        'status': 'PAUSED',
        'budget': campaign.get('budget') or {},
        'targeting': targeting,
        'creatives': creatives,
        'page_id': page_id,
        'image_hash': creatives.get('image_hash'),
        'image_url': creatives.get('image_url'),
        'video_id': creatives.get('video_id'),
        'video_url': creatives.get('video_url'),
        'promoted_object': promoted_object,
        'pixel_id': campaign.get('pixel_id') or targeting.get('pixel_id'),
        'custom_event_type': campaign.get('custom_event_type') or targeting.get('custom_event_type'),
        'application_id': campaign.get('application_id') or targeting.get('application_id'),
        'object_store_url': campaign.get('object_store_url') or targeting.get('object_store_url'),
        'lead_gen_form_id': creatives.get('lead_gen_form_id') or campaign.get('lead_gen_form_id'),
    }
