"""Universal social image specs — one size that works across all feed platforms."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

Purpose = Literal['social_post', 'social_ad']

# OpenAI Images API sizes (gpt-image-* and dall-e-3)
OpenAISize = Literal['1024x1024', '1536x1024', '1024x1536']
OpenAIQuality = Literal['low', 'medium', 'high']


@dataclass(frozen=True)
class SocialImageFormat:
    """Target creative format for cross-platform social posts."""

    label: str
    openai_size: OpenAISize
    openai_quality: OpenAIQuality
    gemini_aspect_ratio: str
    aspect_label: str
    composition_hint: str


# 1:1 fits Instagram (4:5–1.91:1), Facebook, X, and LinkedIn feed crops.
UNIVERSAL_SOCIAL_IMAGE = SocialImageFormat(
    label='cross-platform social feed',
    openai_size='1024x1024',
    openai_quality='high',
    gemini_aspect_ratio='1:1',
    aspect_label='1:1 square',
    composition_hint=(
        'centered subject with safe margins for mobile feed crops on every platform, '
        'readable at small sizes, no watermarks, no mockup frames, no UI chrome'
    ),
)

_SOCIAL_STYLE_SUFFIX = {
    'marketing': (
        'social media advertisement creative, scroll-stopping, mobile-first, '
        'professional campaign quality'
    ),
    'realistic': 'photorealistic social media photography, natural lighting, authentic',
    'product': 'product hero shot for social ad, studio lighting, commercial quality',
    'minimal': 'minimal clean social ad layout, generous whitespace, modern brand feel',
}

_PURPOSE_SUFFIX = {
    'social_post': 'organic social post image',
    'social_ad': 'paid social advertisement creative',
}


def resolve_social_image(body: dict[str, Any]) -> dict[str, Any]:
    """
    Enrich generate_image payload with universal cross-platform size and prompt hints.

    Platform is ignored for dimensions — the same 1:1 image is generated for all networks.
    """
    out = dict(body or {})
    fmt = UNIVERSAL_SOCIAL_IMAGE
    purpose: Purpose = (
        'social_ad' if str(out.get('purpose') or '').lower() == 'social_ad' else 'social_post'
    )
    style = (out.get('style') or '').strip() or 'marketing'

    out['purpose'] = purpose
    out['style'] = style
    out['openai_size'] = fmt.openai_size
    out['openai_quality'] = fmt.openai_quality
    out['gemini_aspect_ratio'] = fmt.gemini_aspect_ratio
    out['aspect_label'] = fmt.aspect_label
    out['_social_format_label'] = fmt.label

    style_bit = _SOCIAL_STYLE_SUFFIX.get(style, _SOCIAL_STYLE_SUFFIX['marketing'])
    purpose_bit = _PURPOSE_SUFFIX[purpose]
    out['_social_prompt_suffix'] = (
        f'{purpose_bit}, {fmt.aspect_label} aspect ratio for {fmt.label}, '
        f'{fmt.composition_hint}, {style_bit}'
    )
    return out


def build_image_prompt(base_prompt: str, body: dict[str, Any]) -> str:
    """Append universal social composition hints."""
    prompt = (base_prompt or '').strip()
    suffix = (body or {}).get('_social_prompt_suffix')
    if suffix:
        return f'{prompt}. {suffix}' if prompt else suffix
    style = (body or {}).get('style') or 'realistic'
    generic = _SOCIAL_STYLE_SUFFIX.get(style, _SOCIAL_STYLE_SUFFIX['realistic'])
    return f'{prompt}, {generic}' if prompt else generic
