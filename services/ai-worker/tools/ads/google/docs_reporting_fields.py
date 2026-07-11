"""Tool: reporting field documentation (reference get_reporting_fields_doc)."""

from __future__ import annotations

from typing import Any, Dict, List

from connectors.google_ads.docs import get_reporting_fields_doc
from tools.ads._errors import ToolValidationError


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    raw = payload.get('fields')
    if raw is None:
        raw = payload.get('field_names') or payload.get('field')
    fields: List[str] = []
    if isinstance(raw, list):
        fields = [str(x).strip() for x in raw if str(x).strip()]
    elif isinstance(raw, str):
        fields = [f.strip() for f in raw.replace('\n', ',').split(',') if f.strip()]
    if not fields:
        raise ToolValidationError('fields is required (list or comma-separated string)')

    out = get_reporting_fields_doc(fields)
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'field documentation lookup failed')
    return out
