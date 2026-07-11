"""Post-LLM workflow graph validation (Stage A)."""

from __future__ import annotations

from typing import Any

from lib.dispatch.registry import get_tool, is_admin_setup_tool, list_tools
from lib.validation.meta_ads_workflow_rules import validate_meta_ads_workflow_graph


def _allowed_intents() -> set[str]:
    return {
        'social_content',
        'ads_campaign',
        'analytics',
        'mixed',
        'informational',
    }


def validate_workflow_graph(graph: dict[str, Any], *, max_steps: int = 10) -> dict[str, Any]:
    """
    Validate planner output. Returns normalized graph or raises ValueError.
    ``max_steps`` comes from Settings → AI → Maximum Workflow Steps (1–50).
    """
    if not isinstance(graph, dict):
        raise ValueError('Workflow graph must be a JSON object')

    steps = graph.get('steps')
    if not isinstance(steps, list) or len(steps) == 0:
        raise ValueError('Workflow must include at least one step')

    limit = max(1, min(int(max_steps or 10), 50))
    if len(steps) > limit:
        raise ValueError(
            f'Workflow exceeds maximum of {limit} steps (Settings → AI → Maximum Workflow Steps)'
        )

    intent = (graph.get('intent') or 'mixed').strip()
    if intent not in _allowed_intents():
        raise ValueError(f'Invalid intent: {intent}')

    known_tools = {t['tool_id'] for t in list_tools()}
    step_ids: set[str] = set()
    normalized_steps: list[dict[str, Any]] = []

    for i, raw in enumerate(steps):
        if not isinstance(raw, dict):
            raise ValueError(f'Step {i} must be an object')
        step_id = (raw.get('step_id') or f'step_{i + 1}').strip()
        if not step_id or step_id in step_ids:
            raise ValueError(f'Duplicate or missing step_id at index {i}')
        step_ids.add(step_id)

        tool_id = (raw.get('tool_id') or '').strip()
        if tool_id not in known_tools:
            raise ValueError(f'Unknown tool_id: {tool_id}')
        if is_admin_setup_tool(tool_id):
            raise ValueError(
                f'Tool {tool_id} is admin/setup only — not allowed in agent campaign workflows. '
                'Use meta_list_ad_pixels / meta_get_ad_pixel for campaign execution, or run the '
                'pixel admin tool via POST /api/ads/tools/execute outside the agent.'
            )

        tool = get_tool(tool_id)
        payload = raw.get('payload')
        if payload is not None and not isinstance(payload, dict):
            raise ValueError(f'Step {step_id} payload must be an object')

        depends_on = raw.get('depends_on') or []
        if not isinstance(depends_on, list):
            raise ValueError(f'Step {step_id} depends_on must be a list')
        for dep in depends_on:
            if dep not in step_ids:
                raise ValueError(f'Step {step_id} depends on unknown step: {dep}')

        normalized_steps.append({
            'step_id': step_id,
            'tool_id': tool_id,
            'payload': payload or {},
            'depends_on': list(depends_on),
            'requires_approval': bool(
                raw.get('requires_approval', tool.get('requires_approval_default')),
            ),
        })

    approval_gates = graph.get('approval_gates') or []
    if not isinstance(approval_gates, list):
        raise ValueError('approval_gates must be a list')
    for gate in approval_gates:
        if gate not in step_ids:
            raise ValueError(f'approval_gate references unknown step: {gate}')

    # Auto-add approval gates for mutating tools not explicitly listed
    for s in normalized_steps:
        if s['requires_approval'] and s['step_id'] not in approval_gates:
            approval_gates.append(s['step_id'])

    _detect_cycles(normalized_steps)

    validate_meta_ads_workflow_graph(normalized_steps, intent=intent)

    summary = (graph.get('summary') or graph.get('assistant_message') or '').strip()
    if not summary:
        raise ValueError('Workflow must include a summary for the user')

    return {
        'intent': intent,
        'summary': summary,
        'assistant_message': (graph.get('assistant_message') or summary).strip(),
        'steps': normalized_steps,
        'dependencies': graph.get('dependencies') or [],
        'parallel_groups': graph.get('parallel_groups') or [],
        'approval_gates': list(dict.fromkeys(approval_gates)),
        'requires_approval': len(approval_gates) > 0,
    }


def _detect_cycles(steps: list[dict[str, Any]]) -> None:
    deps: dict[str, list[str]] = {s['step_id']: list(s.get('depends_on') or []) for s in steps}
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(nid: str) -> None:
        if nid in visiting:
            raise ValueError('Workflow graph contains a dependency cycle')
        if nid in visited:
            return
        visiting.add(nid)
        for d in deps.get(nid, []):
            visit(d)
        visiting.remove(nid)
        visited.add(nid)

    for sid in deps:
        visit(sid)
