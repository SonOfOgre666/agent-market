"""Landing page planner helpers.

Hardcoded LP workflow builders were removed — the planner LLM plans steps
from prompts + tool catalog.
"""

from __future__ import annotations

from typing import Any


def is_actionable_landing_page_request(message: str) -> bool:
    m = (message or '').lower().strip()
    if len(m) < 8:
        return False
    markers = (
        'landing page',
        'lead capture page',
        'lead gen page',
        'create a page for',
        'build a page for',
        'publish a page for',
    )
    if any(k in m for k in markers):
        return True
    if 'landing' in m and any(k in m for k in ('create', 'build', 'publish', 'generate', 'make')):
        return True
    return False


