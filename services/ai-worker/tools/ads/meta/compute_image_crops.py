"""Tool: compute image_crops for create_ad_creative (reference compute_image_crops)."""

from __future__ import annotations

from typing import Any, Dict, List

from connectors.meta_ads.image_crops import compute_image_crops as connector_compute_image_crops
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        width = int(payload.get('image_width') or payload.get('width') or 0)
        height = int(payload.get('image_height') or payload.get('height') or 0)
    except (TypeError, ValueError) as exc:
        raise ToolValidationError('image_width and image_height must be integers') from exc

    crop_keys = payload.get('crop_keys')
    keys: List[str] | None = None
    if isinstance(crop_keys, list):
        keys = [str(k) for k in crop_keys if k]

    out = connector_compute_image_crops(image_width=width, image_height=height, crop_keys=keys)
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'compute_image_crops failed')
    return out
