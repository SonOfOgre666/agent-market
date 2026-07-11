"""Universal social video specs — one vertical format for all video platforms."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

OpenAIVideoSize = str


@dataclass(frozen=True)
class SocialVideoFormat:
    """Target creative format for cross-platform social video."""

    label: str
    gemini_aspect_ratio: str
    aspect_label: str
    openai_size_default: OpenAIVideoSize
    openai_size_pro: OpenAIVideoSize
    duration_seconds: int
    composition_hint: str


# 9:16 vertical works on TikTok, Reels, Facebook, X, and LinkedIn.
UNIVERSAL_SOCIAL_VIDEO = SocialVideoFormat(
    label='cross-platform social video',
    gemini_aspect_ratio='9:16',
    aspect_label='9:16 vertical',
    openai_size_default='720x1280',
    openai_size_pro='1080x1920',
    duration_seconds=8,
    composition_hint=(
        'vertical mobile-first framing, subject centered with headroom, '
        'thumb-stopping motion safe for TikTok, Reels, and feed video'
    ),
)


def resolve_openai_video_size(model: str) -> str:
    """Pick the tallest supported 9:16 preset for the configured Sora model."""
    fmt = UNIVERSAL_SOCIAL_VIDEO
    if 'pro' in (model or '').lower():
        return fmt.openai_size_pro
    return fmt.openai_size_default


def resolve_social_video(body: dict[str, Any], *, model: str = '') -> dict[str, Any]:
    """
    Enrich generate_video payload with universal cross-platform size and prompt hints.

    Platform is ignored for dimensions — the same 9:16 clip is generated for all networks.
    """
    out = dict(body or {})
    fmt = UNIVERSAL_SOCIAL_VIDEO
    style = (out.get('style') or '').strip() or 'cinematic'

    out['style'] = style
    out['gemini_aspect_ratio'] = fmt.gemini_aspect_ratio
    out['openai_video_size'] = resolve_openai_video_size(model)
    out['video_duration_seconds'] = fmt.duration_seconds
    out['aspect_label'] = fmt.aspect_label
    out['_social_format_label'] = fmt.label
    out['_social_video_suffix'] = (
        f'{fmt.aspect_label} {fmt.label}, {fmt.composition_hint}'
    )
    return out
