"""Classify post version media for social publish (video, thumbnail, images)."""

from __future__ import annotations

from typing import Any, TypedDict


class MediaParts(TypedDict):
    videos: list[dict[str, Any]]
    images: list[dict[str, Any]]
    thumbnails: list[dict[str, Any]]
    all_items: list[dict[str, Any]]


def _is_video_item(item: dict[str, Any]) -> bool:
    role = str(item.get('role') or '').lower()
    mime = str(item.get('mime_type') or '').lower()
    return role == 'video' or mime.startswith('video/')


def _is_thumbnail_item(item: dict[str, Any]) -> bool:
    return str(item.get('role') or '').lower() == 'thumbnail'


def collect_media_items(version: dict[str, Any]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for block in version.get('content') or []:
        if block.get('type') == 'media':
            for row in block.get('media') or []:
                if isinstance(row, dict):
                    items.append(row)
    return items


def partition_post_media(version: dict[str, Any]) -> MediaParts:
    """
    Split version media into primary video, gallery images, and optional video thumbnail.

    Rules:
    - role=video | mime video/* → videos
    - role=thumbnail → thumbnails
    - everything else → images
    - legacy: exactly one video + one non-video without roles → non-video is thumbnail
    """
    all_items = collect_media_items(version)
    videos: list[dict[str, Any]] = []
    images: list[dict[str, Any]] = []
    thumbnails: list[dict[str, Any]] = []

    for item in all_items:
        if _is_video_item(item):
            videos.append(item)
        elif _is_thumbnail_item(item):
            thumbnails.append(item)
        else:
            images.append(item)

    if len(videos) == 1 and len(images) == 1 and not thumbnails:
        thumbnails = images
        images = []

    return {
        'videos': videos,
        'images': images,
        'thumbnails': thumbnails,
        'all_items': all_items,
    }


def primary_video(parts: MediaParts) -> dict[str, Any] | None:
    return parts['videos'][0] if parts['videos'] else None


def primary_thumbnail(parts: MediaParts) -> dict[str, Any] | None:
    return parts['thumbnails'][0] if parts['thumbnails'] else None
