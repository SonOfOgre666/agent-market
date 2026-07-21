"""Social planner helpers.

Hardcoded social workflow builders were removed — the planner LLM plans steps
from prompts + tool catalog (same as Meta/Google ads).
"""

from __future__ import annotations

from typing import Any


def is_actionable_social_request(message: str) -> bool:
    m = (message or '').lower()
    if len(m) < 8:
        return False
    action = any(
        k in m
        for k in (
            'create',
            'write',
            'generate',
            'make',
            'publish',
            'schedule',
            'post about',
            'post on',
            'save',
            'draft',
        )
    )
    channel = any(
        k in m
        for k in (
            'facebook',
            'instagram',
            'twitter',
            'linkedin',
            'tiktok',
            'social',
            'page',
        )
    )
    return action and (channel or 'post' in m)


def resolve_max_workflow_steps(ctx: dict[str, Any] | None) -> int:
    """From Settings → AI → Marketing Assistant → Maximum Workflow Steps."""
    n = int((ctx or {}).get('max_workflow_steps') or 10)
    return max(1, min(n, 50))


def normalize_planner_payload(parsed: dict[str, Any]) -> dict[str, Any]:
    """Fix common planner JSON shapes before validation."""
    if not isinstance(parsed, dict):
        return {}
    out = dict(parsed)
    if isinstance(out.get('workflow'), dict):
        nested = out.pop('workflow')
        for key in ('steps', 'intent', 'summary', 'assistant_message', 'approval_gates'):
            if key not in out and nested.get(key) is not None:
                out[key] = nested[key]
    steps = out.get('steps')
    if steps is None:
        out['steps'] = []
    elif not isinstance(steps, list):
        out['steps'] = []
    return out


