from __future__ import annotations

from typing import Any, Dict

from tools.ads.reporting._google import run_google_operation


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    return run_google_operation('ad_groups', payload)
