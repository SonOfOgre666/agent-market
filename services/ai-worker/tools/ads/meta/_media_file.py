"""Resolve media library attachments for Meta upload tools."""

from __future__ import annotations

from typing import Any, Dict, Optional

from lib import worker_api
from tools.ads._errors import ToolValidationError


def resolve_upload_file(payload: Dict[str, Any]) -> Optional[str]:
    """
    Return base64/data-URL ``file`` for Meta upload when ``media_id`` is set.
    Leaves payload unchanged when ``file`` or public ``image_url`` / ``video_url`` already set.
    """
    if payload.get('file'):
        return str(payload['file'])
    if payload.get('image_url') or payload.get('video_url'):
        return None

    media_id = str(payload.get('media_id') or '').strip()
    if not media_id:
        return None
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
