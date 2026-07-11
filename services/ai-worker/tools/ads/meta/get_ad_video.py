"""Tool: get Meta ad video source URL (reference get_ad_video)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.meta_ads import get_ad_video as connector_get_ad_video
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')

    ad_id = str(payload.get('ad_id') or payload.get('platform_ad_id') or '').strip()
    video_id = str(payload.get('video_id') or '').strip()
    if not ad_id and not video_id:
        raise ToolValidationError('ad_id or video_id is required')

    out = connector_get_ad_video(
        token,
        ad_id=ad_id,
        video_id=video_id,
        account_id=str(payload.get('ad_account_id') or payload.get('account_id') or ''),
        api_version=str(payload.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'Meta get ad video failed')
    return out
