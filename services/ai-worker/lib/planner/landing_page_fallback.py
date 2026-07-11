"""Deterministic landing page workflow when planner LLM returns no steps."""

from __future__ import annotations

import re
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


def _extract_title(message: str) -> str:
    text = (message or '').strip()
    for pattern in (
        r'landing page (?:for|about)\s+(.+?)(?:\.|$)',
        r'create (?:a )?landing page(?: for)?\s+(.+?)(?:\.|$)',
        r'build (?:a )?page for\s+(.+?)(?:\.|$)',
    ):
        m = re.search(pattern, text, re.I)
        if m:
            title = m.group(1).strip().strip('"\'')
            if title:
                return title[:120]
    return text[:120] or 'New landing page'


def build_fallback_landing_page_workflow(message: str, ctx: dict[str, Any]) -> dict[str, Any]:
    title = _extract_title(message)
    ws = ctx.get('workspace_id')
    publish = any(k in (message or '').lower() for k in ('publish', 'go live', 'live now'))
    return {
        'intent': 'landing_page',
        'summary': f'Create landing page: {title}',
        'requires_approval': True,
        'assistant_message': (
            f'I will create a landing page titled "{title}", generate AI marketing copy, '
            f'{"and publish it for lead capture" if publish else "and save it as a draft"}. '
            'Approve to proceed.'
        ),
        'steps': [
            {
                'step_id': 'step_lp_1',
                'tool_id': 'run_landing_page_workflow',
                'label': 'Create landing page',
                'payload': {
                    'workspace_id': ws,
                    'title': title,
                    'publish': publish,
                },
                'requires_approval': True,
            },
        ],
    }
