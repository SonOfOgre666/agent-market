"""Tool: pause Google campaign (reference pause_campaign)."""

from __future__ import annotations

from typing import Any, Dict

from tools.ads.google.update_campaign import run as update_campaign


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    payload = {**payload, 'status': 'paused'}
    return update_campaign(payload)
