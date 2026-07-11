"""Tool: upload video for Meta creatives (Graph advideos → video_id)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.meta_ads import upload_ad_video as connector_upload_ad_video
from tools.ads._errors import ToolValidationError
from tools.ads.meta._media_file import resolve_upload_file


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    token = (payload.get('access_token') or '').strip()
    if not token:
        raise ToolValidationError('access_token is required')

    account_id = payload.get('ad_account_id') or payload.get('account_id')
    if not account_id:
        raise ToolValidationError('ad_account_id is required')

    body = dict(payload)
    file = resolve_upload_file(body)
    video_url = None if file else body.get('video_url')
    if not file and not video_url:
        raise ToolValidationError(
            'Provide media_id (library attachment), file, or public HTTPS video_url'
        )

    out = connector_upload_ad_video(
        token,
        account_id=str(account_id),
        video_url=video_url,
        file=file,
        name=body.get('name'),
        api_version=str(body.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'Meta upload ad video failed')
    return out
