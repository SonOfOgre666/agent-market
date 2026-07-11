"""Resolve image_hash for Meta link creatives (reference: upload_ad_image → create_ad_creative)."""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

from tools.ads._errors import ToolValidationError
from tools.ads.meta.upload_ad_image import run as upload_ad_image
from tools.ads.meta.upload_ad_video import run as upload_ad_video


def resolve_image_hash(
    payload: Dict[str, Any],
    *,
    token: str,
    ad_account_id: str,
) -> Tuple[Optional[str], Optional[str]]:
    """
    Return (image_hash, note) for create_ad_creative.

  Reference flow requires one of image_hash, image_hashes, video_id, videos, images,
  or object_story_id. Link ads typically: meta_upload_ad_image → image_hash.
    """
    creatives = dict(payload.get('creatives') or {})
    existing = payload.get('image_hash') or creatives.get('image_hash')
    if existing:
        return str(existing).strip(), None

    hashes = payload.get('image_hashes') or creatives.get('image_hashes')
    if isinstance(hashes, list) and hashes:
        return str(hashes[0]).strip(), None

    if payload.get('object_story_id') or creatives.get('object_story_id'):
        return None, None

    if payload.get('video_id') or creatives.get('video_id') or payload.get('videos') or creatives.get('videos'):
        return None, None

    image_url = (
        creatives.get('image_url')
        or creatives.get('picture_url')
        or payload.get('image_url')
        or payload.get('picture_url')
    )
    if image_url:
        out = upload_ad_image(
            {
                'access_token': token,
                'ad_account_id': str(ad_account_id),
                'image_url': str(image_url).strip(),
                'name': creatives.get('image_name') or payload.get('name'),
            }
        )
        ih = out.get('image_hash')
        if ih:
            return str(ih), 'Uploaded image_url to Meta (meta_upload_ad_image)'
        raise ToolValidationError(out.get('error') or 'meta_upload_ad_image failed')

    return None, None


def resolve_video_id(
    payload: Dict[str, Any],
    *,
    token: str,
    ad_account_id: str,
) -> Tuple[Optional[str], Optional[str]]:
    """Return (video_id, note) for create_ad_creative video_data path."""
    creatives = dict(payload.get('creatives') or {})
    existing = payload.get('video_id') or creatives.get('video_id')
    if existing:
        return str(existing).strip(), None

    video_url = creatives.get('video_url') or payload.get('video_url')
    if video_url:
        out = upload_ad_video(
            {
                'access_token': token,
                'ad_account_id': str(ad_account_id),
                'video_url': str(video_url).strip(),
                'name': creatives.get('video_name') or payload.get('name'),
            }
        )
        vid = out.get('video_id') or out.get('id')
        if vid:
            return str(vid), 'Uploaded video_url to Meta (meta_upload_ad_video)'
        raise ToolValidationError(out.get('error') or 'meta_upload_ad_video failed')

    return None, None


def require_media_for_link_creative(payload: Dict[str, Any], image_hash: Optional[str]) -> None:
    creatives = dict(payload.get('creatives') or {})
    if payload.get('object_story_id') or creatives.get('object_story_id'):
        return
    if image_hash:
        return
    if payload.get('video_id') or creatives.get('video_id') or creatives.get('video_url') or payload.get('video_url'):
        return
    raise ToolValidationError(
        'Ad creative requires media. Add creatives.image_url (public HTTPS) or creatives.image_hash '
        '(from meta_upload_ad_image), creatives.video_url / video_id (meta_upload_ad_video), '
        'or object_story_id for an existing Page post.'
    )


def require_media_for_video_creative(payload: Dict[str, Any], video_id: Optional[str]) -> None:
    creatives = dict(payload.get('creatives') or {})
    if payload.get('object_story_id') or creatives.get('object_story_id'):
        return
    if video_id:
        return
    raise ToolValidationError(
        'Video ad creative requires video_id or creatives.video_url (public HTTPS). '
        'Workflow: meta_upload_ad_video → meta_create_creative(video_id) → meta_create_ad.'
    )
