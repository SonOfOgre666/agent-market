from __future__ import annotations

from typing import Any, Dict

from tools.ads._errors import ToolValidationError
from tools.ads.reporting._google import run_google_operation


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    if not (payload.get('query') or '').strip():
        raise ToolValidationError('query is required')
    return run_google_operation('gaql', payload)
