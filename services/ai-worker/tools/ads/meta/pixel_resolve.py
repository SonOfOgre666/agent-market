"""Resolve Meta pixel_id from payload or ad account (single-pixel auto-select)."""

from __future__ import annotations

from typing import Any, Dict, Optional

from connectors.meta_ads.pixels import resolve_default_pixel_id


def pick_pixel_id(
    payload: Dict[str, Any],
    *,
    token: str = '',
    ad_account_id: str = '',
    auto_select_single: bool = True,
) -> Optional[str]:
    """
    Return pixel_id from payload/targeting/creatives, or auto-select when the ad account
    has exactly one available pixel (Graph /adspixels).
    """
    targeting = dict(payload.get('targeting') or {})
    creatives = dict(payload.get('creatives') or {})
    for src in (payload, targeting, creatives):
        if not isinstance(src, dict):
            continue
        raw = str(src.get('pixel_id') or '').strip()
        if raw:
            return raw

    if auto_select_single and token and ad_account_id:
        return resolve_default_pixel_id(
            token,
            account_id=str(ad_account_id),
            api_version=str(payload.get('api_version') or 'v22.0'),
        )
    return None
