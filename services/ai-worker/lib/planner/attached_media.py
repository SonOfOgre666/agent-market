"""User-provided media library attachments for planner workflows."""

from __future__ import annotations

import json
from typing import Any

_SKIP_WHEN_ATTACHED = frozenset({
    'generate_image',
    'generate_image_script',
    'generate_video',
    'generate_video_script',
})


def primary_attachment(attached_media: list[dict[str, Any]] | None) -> dict[str, Any] | None:
    if not attached_media:
        return None
    for item in attached_media:
        if (item.get('mime_type') or '').startswith('video/'):
            return item
    return attached_media[0]


def cover_attachment(attached_media: list[dict[str, Any]] | None) -> dict[str, Any] | None:
    """Optional cover image when user attached video + image in agent chat."""
    if not attached_media or len(attached_media) < 2:
        return None
    primary = primary_attachment(attached_media)
    if not is_video_attachment(primary):
        return None
    primary_id = str(primary.get('id') or '')
    for item in attached_media:
        if str(item.get('id') or '') == primary_id:
            continue
        mime = str(item.get('mime_type') or '')
        if mime.startswith('image/'):
            return item
    return None


def is_video_attachment(item: dict[str, Any] | None) -> bool:
    return bool((item or {}).get('mime_type', '').startswith('video/'))


def format_attached_media_block(attached_media: list[dict[str, Any]] | None) -> str:
    if not attached_media:
        return ''
    primary = primary_attachment(attached_media)
    cover = cover_attachment(attached_media)
    lines = [
        'USER-PROVIDED MEDIA (use instead of generating new media):',
        json.dumps(attached_media, indent=2, default=str),
    ]
    if primary:
        kind = 'video' if is_video_attachment(primary) else 'image'
        lines.append(
            f'Primary attachment: {kind} media_id={primary.get("id")} '
            f'url={primary.get("url")}. '
            'Do NOT plan generate_image, generate_image_script, generate_video, or generate_video_script '
            'unless the user explicitly asks for AI-generated media in addition to the attachment.'
        )
        if cover:
            lines.append(
                f'Cover image attachment: media_id={cover.get("id")} url={cover.get("url")}. '
                'For video posts, pass this as thumbnail_media_id on create_draft_post alongside media_id.'
            )
        else:
            lines.append(
                'For social posts: generate_social_post → create_draft_post with media_id set to the attachment id.'
            )
        lines.append(
            'For Meta ads with image: use meta_upload_ad_image with media_id (library attachment) '
            'or image_url when the URL is public HTTPS. Do not use localhost/API upload URLs.'
        )
        lines.append(
            'For Meta ads with video: use meta_upload_ad_video with video_url from attachment url.'
        )
    return '\n'.join(lines) + '\n\n'


def reconcile_attached_media_steps(
    graph: dict[str, Any],
    attached_media: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    """Remove AI media generation when the user supplied library media."""
    primary = primary_attachment(attached_media)
    if not primary or not isinstance(graph, dict):
        return graph

    cover = cover_attachment(attached_media)
    steps = graph.get('steps')
    if not isinstance(steps, list) or not steps:
        return graph

    media_id = str(primary.get('id') or '')
    media_url = str(primary.get('url') or '')
    is_video = is_video_attachment(primary)
    if not media_id:
        return graph

    post_step = next((s for s in steps if s.get('tool_id') == 'generate_social_post'), None)
    post_step_id = post_step.get('step_id') if post_step else None

    kept: list[dict[str, Any]] = []
    for step in steps:
        tool_id = step.get('tool_id')
        if tool_id in _SKIP_WHEN_ATTACHED:
            continue

        step_copy = dict(step)
        payload = dict(step_copy.get('payload') or {})

        if tool_id == 'create_draft_post':
            for key in ('image', 'video', 'thumbnail', 'image_data_url', 'video_data_url'):
                payload.pop(key, None)
            payload['media_id'] = media_id
            if is_video:
                payload['post_type'] = 'video'
            if cover and cover.get('id'):
                payload['thumbnail_media_id'] = str(cover.get('id'))
            step_copy['payload'] = payload
            if post_step_id:
                step_copy['depends_on'] = [post_step_id]

        elif tool_id == 'meta_upload_ad_image' and not is_video:
            if media_id:
                payload['media_id'] = media_id
                payload.pop('image_url', None)
            elif media_url:
                payload['image_url'] = media_url
            step_copy['payload'] = payload

        elif tool_id == 'meta_upload_ad_video' and media_url and is_video:
            payload['video_url'] = media_url
            step_copy['payload'] = payload

        elif tool_id in ('meta_publish_campaign', 'meta_create_creative'):
            creatives = dict(payload.get('creatives') or {})
            if is_video and media_url:
                creatives['video_url'] = media_url
            elif media_url:
                creatives['image_url'] = media_url
            if creatives:
                payload['creatives'] = creatives
                step_copy['payload'] = payload

        kept.append(step_copy)

    out = dict(graph)
    out['steps'] = kept
    return out
