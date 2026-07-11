"""Tool: publish Google campaign chain — routes by payload type (meta_publish_campaign parity)."""

from __future__ import annotations

from typing import Any, Dict

from tools.ads.google.create_campaign import run as create_campaign


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Full end-to-end publish routed by type (search|display|video|shopping|performance_max|app|local).
    Same as google_create_campaign; explicit tool_id for planner/UI symmetry with Meta.
    """
    return create_campaign(payload)
