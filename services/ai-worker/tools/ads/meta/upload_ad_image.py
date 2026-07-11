"""Tool: upload image for Meta creatives (reference upload_ad_image)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.meta_ads import upload_ad_image as connector_upload_ad_image
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
    image_url = None if file else body.get('image_url')
    if not file and not image_url and not body.get('media_id'):
        raise ToolValidationError('Provide media_id (library attachment), file, or public HTTPS image_url')

    out = connector_upload_ad_image(
        token,
        account_id=str(account_id),
        file=file,
        image_url=image_url,
        name=body.get('name'),
        api_version=str(body.get('api_version') or 'v22.0'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'Meta upload ad image failed')
    return out
