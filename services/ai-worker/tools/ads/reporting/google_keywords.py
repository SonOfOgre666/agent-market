from __future__ import annotations

from typing import Any, Dict

from tools.ads.reporting._google import run_google_operation


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    body = dict(payload or {})
    body.setdefault('date_range', 'LAST_30_DAYS')
    return run_google_operation('keywords', body)
