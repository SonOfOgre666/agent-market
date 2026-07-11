"""Route full-publish requests by campaign type."""

from __future__ import annotations

from typing import Any, Dict

from .publish_app import publish_app_campaign
from .publish_display import publish_display_campaign
from .publish_local import publish_local_campaign
from .publish_performance_max import publish_performance_max_campaign
from .publish_search import publish_search_campaign
from .publish_shopping import publish_shopping_campaign
from .publish_video import publish_video_campaign
from .utils import map_channel_type


_PUBLISHERS = {
    'search': publish_search_campaign,
    'display': publish_display_campaign,
    'video': publish_video_campaign,
    'shopping': publish_shopping_campaign,
    'performance_max': publish_performance_max_campaign,
    'app': publish_app_campaign,
    'local': publish_local_campaign,
}


def publish_campaign_by_type(
    *,
    google_ads_client_config: Dict[str, Any],
    customer_id: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    raw = payload.get('type') or payload.get('campaign_type') or payload.get('channel') or 'search'
    channel = map_channel_type(str(raw))
    publisher = _PUBLISHERS.get(channel)
    if not publisher:
        raise ValueError(f'Unsupported Google campaign type for full publish: {raw}')
    return publisher(
        google_ads_client_config=google_ads_client_config,
        customer_id=customer_id,
        payload=payload,
    )
