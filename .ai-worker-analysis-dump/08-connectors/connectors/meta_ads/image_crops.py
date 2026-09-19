"""Image crop helpers — reference ``compute_image_crops`` (no Graph call)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

_VALID_CROP_KEYS: Tuple[Tuple[str, int, int], ...] = (
    ('100x100', 100, 100),
    ('100x72', 100, 72),
    ('400x500', 400, 500),
    ('400x150', 400, 150),
    ('600x360', 600, 360),
    ('90x160', 90, 160),
)
_VALID_CROP_KEY_NAMES = [k for k, _, _ in _VALID_CROP_KEYS]


def _compute_crop_box(src_w: int, src_h: int, kw: int, kh: int) -> List[List[int]]:
    crop_w_from_h = src_h * kw / kh
    if crop_w_from_h <= src_w:
        crop_w = round(crop_w_from_h)
        crop_h = src_h
    else:
        crop_w = src_w
        crop_h = round(src_w * kh / kw)
    x1 = (src_w - crop_w) // 2
    y1 = (src_h - crop_h) // 2
    return [[x1, y1], [x1 + crop_w, y1 + crop_h]]


def compute_image_crops(
    *,
    image_width: int,
    image_height: int,
    crop_keys: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Compute ``image_crops`` for ``create_ad_creative`` — reference ``compute_image_crops``.
    """
    if image_width <= 0 or image_height <= 0:
        return {'ok': False, 'error': 'image_width and image_height must be positive integers'}

    requested = list(crop_keys) if crop_keys else list(_VALID_CROP_KEY_NAMES)
    key_map = {k: (kw, kh) for k, kw, kh in _VALID_CROP_KEYS}
    crops: Dict[str, List[List[int]]] = {}
    warnings: List[str] = []

    for key in requested:
        if key not in key_map:
            warnings.append(
                f"'{key}' is not a valid Meta API crop key. Valid: {', '.join(_VALID_CROP_KEY_NAMES)}",
            )
            continue
        kw, kh = key_map[key]
        crops[key] = _compute_crop_box(image_width, image_height, kw, kh)

    out: Dict[str, Any] = {
        'ok': True,
        'image_crops': crops,
        'source_dimensions': {'width': image_width, 'height': image_height},
        'usage': 'Pass image_crops to meta_create_creative',
    }
    if warnings:
        out['warnings'] = warnings
    return out
