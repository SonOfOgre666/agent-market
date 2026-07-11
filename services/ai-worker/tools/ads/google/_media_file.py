"""Resolve media library attachments for Google publish tools."""

from __future__ import annotations

from typing import Any, Dict, Optional

from lib import worker_api
from tools.ads._errors import ToolValidationError


def _fetch_media_file(payload: Dict[str, Any], media_id: str) -> str:
    if not worker_api.configured():
        raise ToolValidationError('media_id requires WORKER_API_SECRET / INTERNAL_API_URL')
    workspace_id = str(payload.get('workspace_id') or '').strip() or None
    try:
        row = worker_api.fetch_media_file(media_id, workspace_id=workspace_id)
    except Exception as exc:
        raise ToolValidationError(f'Could not load media library file: {exc}') from exc
    if not row.get('ok') or not row.get('file'):
        raise ToolValidationError(row.get('error') or 'Could not load media library file')
    return str(row['file'])


def resolve_creative_media(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Inject base64 image data from media_id fields into creatives before publish.

    Supports: media_id (generic), logo_media_id, marketing_media_id, square_media_id.
    """
    body = dict(payload)
    creatives = dict(body.get('creatives') or {})

    def _maybe_set_image_data(key: str, media_key: str, creative_key: str) -> None:
        mid = str(body.get(media_key) or '').strip()
        if not mid:
            return
        if creatives.get(creative_key):
            return
        file_data = _fetch_media_file(body, mid)
        creatives[creative_key] = [file_data]

    _maybe_set_image_data('logo', 'logo_media_id', 'logo_image_data')
    _maybe_set_image_data('marketing', 'marketing_media_id', 'marketing_image_data')
    _maybe_set_image_data('square', 'square_media_id', 'square_image_data')

    generic_id = str(body.get('media_id') or '').strip()
    if generic_id:
        file_data = _fetch_media_file(body, generic_id)
        if not creatives.get('logo_image_data') and (
            body.get('logo_media_id') or body.get('type') in ('video', 'performance_max', 'local')
        ):
            creatives.setdefault('logo_image_data', []).append(file_data)
        if body.get('type') in ('display', 'performance_max', 'local'):
            creatives.setdefault('marketing_image_data', []).append(file_data)
            creatives.setdefault('square_image_data', []).append(file_data)

    if creatives:
        body['creatives'] = creatives
    return body
