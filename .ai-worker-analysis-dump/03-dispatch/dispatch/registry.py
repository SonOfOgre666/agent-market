"""Tool registry — single source of truth for executable capabilities."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_REGISTRY: dict[str, Any] | None = None
_ROOT = Path(__file__).resolve().parents[2]


def load_registry() -> dict[str, Any]:
    global _REGISTRY
    if _REGISTRY is None:
        path = _ROOT / 'registry' / 'tools.json'
        with open(path, encoding='utf-8') as f:
            _REGISTRY = json.load(f)
    return _REGISTRY


def list_tools() -> list[dict[str, Any]]:
    return list(load_registry().get('tools') or [])


def get_tool(tool_id: str) -> dict[str, Any] | None:
    for t in list_tools():
        if t.get('tool_id') == tool_id:
            return t
    return None


AGENT_FLOW_CAMPAIGN = 'campaign'
AGENT_FLOW_ADMIN_SETUP = 'admin_setup'


def tool_agent_flow(tool: dict[str, Any] | None) -> str:
    """``campaign`` (default) = planner + agent workflows; ``admin_setup`` = direct API only."""
    if not tool:
        return AGENT_FLOW_CAMPAIGN
    return str(tool.get('agent_flow') or AGENT_FLOW_CAMPAIGN)


def is_admin_setup_tool(tool_id: str) -> bool:
    return tool_agent_flow(get_tool(tool_id)) == AGENT_FLOW_ADMIN_SETUP


def tool_catalog_for_planner(route: str | None = None) -> list[dict[str, str]]:
    """Minimal tool metadata injected into planner prompts (no task paths)."""
    from lib.planner.intent_router import tool_id_allowed_for_route

    out = []
    for t in list_tools():
        if tool_agent_flow(t) != AGENT_FLOW_CAMPAIGN:
            continue
        tool_id = str(t.get('tool_id') or '')
        if route and route not in ('general', '') and not tool_id_allowed_for_route(tool_id, route):
            continue
        out.append({
            'tool_id': tool_id,
            'description': t.get('description') or '',
            'risk_tier': t.get('risk_tier') or 'low',
            'requires_approval': bool(t.get('requires_approval_default')),
        })
    return out


def resolve_dispatch(tool_id: str) -> dict[str, Any]:
    """Map tool_id → Celery task name + optional opcode."""
    tool = get_tool(tool_id)
    if not tool:
        raise ValueError(f'Unknown tool_id: {tool_id}')
    return {
        'tool_id': tool_id,
        'task': tool['task'],
        'opcode': tool.get('opcode'),
        'requires_approval': bool(tool.get('requires_approval_default')),
        'side_effect_class': tool.get('side_effect_class') or 'internal',
    }
