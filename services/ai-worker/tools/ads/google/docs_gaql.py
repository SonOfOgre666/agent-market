"""Tool: GAQL documentation (reference get_gaql_doc)."""

from __future__ import annotations

from typing import Any, Dict

from connectors.google_ads.docs import get_gaql_doc


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    return get_gaql_doc()
