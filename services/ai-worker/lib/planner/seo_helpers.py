"""SEO planner helpers.

Hardcoded SEO workflow builders were removed — the planner LLM plans steps
from prompts + tool catalog.
"""

from __future__ import annotations

from typing import Any


def is_actionable_seo_request(message: str) -> bool:
    m = (message or '').lower().strip()
    if len(m) < 6:
        return False
    if any(
        k in m
        for k in (
            'seo',
            'keyword cluster',
            'cluster keywords',
            'rank check',
            'rank tracking',
            'serp rank',
            'search rank',
            'landing page audit',
            'audit landing',
            'competitive analysis',
            'competitor analysis',
            'competitor intel',
            'ads library',
            'content calendar',
            'calendar suggestions',
            'post ideas',
        )
    ):
        return True
    if 'keyword' in m and any(k in m for k in ('cluster', 'group', 'intent', 'track', 'rank')):
        return True
    if 'competitor' in m and any(k in m for k in ('analyze', 'analysis', 'research', 'scrape')):
        return True
    return False


