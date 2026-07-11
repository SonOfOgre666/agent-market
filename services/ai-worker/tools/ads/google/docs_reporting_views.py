"""Tool: reporting views documentation (reference get_reporting_view_doc)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.google_ads.docs import get_reporting_views_doc


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    view = payload.get('view') or payload.get('resource_view')
    return get_reporting_views_doc(view=str(view).strip() if view else None)
