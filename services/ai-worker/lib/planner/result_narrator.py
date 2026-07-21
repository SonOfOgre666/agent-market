"""Post-execution LLM narrator — explores step results and writes the user reply."""

from __future__ import annotations

import json
import logging
from typing import Any

from lib.prompt_loader import load_prompt

logger = logging.getLogger(__name__)

_MAX_JSON_CHARS = 12_000
_MAX_STRING = 800
_MAX_LIST = 40
_MAX_DEPTH = 6


def _truncate_str(value: str, limit: int = _MAX_STRING) -> str:
    text = value.strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)] + '…'


def _compact(value: Any, *, depth: int = 0) -> Any:
    if depth > _MAX_DEPTH:
        return '…'
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return _truncate_str(value)
    if isinstance(value, list):
        items = [_compact(v, depth=depth + 1) for v in value[:_MAX_LIST]]
        if len(value) > _MAX_LIST:
            items.append(f'… (+{len(value) - _MAX_LIST} more)')
        return items
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for i, (k, v) in enumerate(value.items()):
            if i >= 60:
                out['…'] = f'+{len(value) - 60} keys'
                break
            out[str(k)] = _compact(v, depth=depth + 1)
        return out
    return _truncate_str(str(value))


def compact_step_results(
    step_results: dict[str, Any] | None,
    graph: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Build a compact, ordered view of steps for the narrator prompt."""
    results = step_results if isinstance(step_results, dict) else {}
    steps = (graph or {}).get('steps') if isinstance(graph, dict) else None
    ordered_ids: list[str] = []
    if isinstance(steps, list):
        for step in steps:
            if isinstance(step, dict) and step.get('step_id'):
                ordered_ids.append(str(step['step_id']))
    for sid in results:
        if sid not in ordered_ids:
            ordered_ids.append(str(sid))

    tool_by_id: dict[str, str] = {}
    if isinstance(steps, list):
        for step in steps:
            if isinstance(step, dict) and step.get('step_id'):
                tool_by_id[str(step['step_id'])] = str(step.get('tool_id') or '')

    compact_steps: list[dict[str, Any]] = []
    for sid in ordered_ids:
        row = results.get(sid) if isinstance(results.get(sid), dict) else {}
        entry: dict[str, Any] = {
            'step_id': sid,
            'tool_id': row.get('tool_id') or tool_by_id.get(sid) or '',
            'status': row.get('status') or 'unknown',
        }
        if row.get('error'):
            entry['error'] = _compact(row.get('error'))
        if row.get('output') is not None:
            entry['output'] = _compact(row.get('output'))
        compact_steps.append(entry)
    return compact_steps


def _dumps(data: Any) -> str:
    text = json.dumps(data, indent=2, default=str, ensure_ascii=False)
    if len(text) <= _MAX_JSON_CHARS:
        return text
    return text[: _MAX_JSON_CHARS - 1] + '…'


def _fallback_message(
    *,
    status: str,
    errors: list[Any] | None,
    compact_steps: list[dict[str, Any]],
) -> str:
    """Last-resort factual message when the narrator LLM is unavailable."""
    errs = [str(e).strip() for e in (errors or []) if str(e).strip()]
    failed = [s for s in compact_steps if s.get('status') == 'failed']
    empty_reads = []
    for s in compact_steps:
        out = s.get('output')
        if s.get('status') == 'completed' and out in ([], {}, None):
            empty_reads.append(s.get('tool_id') or s.get('step_id'))

    if status == 'failed' or failed:
        detail = errs[0] if errs else (failed[0].get('error') if failed else None)
        if detail:
            return f'There was a problem completing your request: {detail}'
        return 'There was a problem completing your request. Please try again or check the failed step details.'
    if empty_reads and not any(
        s.get('status') == 'completed' and s.get('output') not in ([], {}, None)
        for s in compact_steps
    ):
        return 'I looked this up and found nothing matching your request.'
    if status == 'completed':
        return 'Your request finished successfully. Open the workflow steps for full details.'
    return f'Workflow status: {status}.'


def should_narrate_result(
    *,
    status: str,
    graph: dict[str, Any] | None,
) -> bool:
    """Skip narration when there is nothing useful to tell the user yet."""
    st = (status or '').lower()
    if st not in ('completed', 'failed'):
        return False
    g = graph if isinstance(graph, dict) else {}
    # Discovery/setup phases already set a clarification summary for the next turn.
    if g.get('meta_setup_phase') == 'discovery' and st == 'completed':
        return False
    if g.get('google_setup_phase') == 'discovery' and st == 'completed':
        return False
    return True


def narrate_workflow_result(
    *,
    workspace_id: str | None,
    user_message: str,
    status: str,
    graph: dict[str, Any] | None,
    step_results: dict[str, Any] | None,
    errors: list[Any] | None = None,
) -> str:
    """
    Explore execution results with the planner LLM and return one assistant message.

    Falls back to a short factual string only if the model call fails.
    """
    g = graph if isinstance(graph, dict) else {}
    compact_steps = compact_step_results(step_results, g)
    errs = list(errors or [])
    fallback = _fallback_message(status=status, errors=errs, compact_steps=compact_steps)

    try:
        from lib.ai_workspace_config import get_planner_config
        from lib.llm import text as text_llm

        cfg = get_planner_config(workspace_id)
        prompt = load_prompt(
            'agent/result_summary.md',
            user_message=_truncate_str(str(user_message or ''), 2000) or '(no message)',
            status=str(status or 'unknown'),
            intent=str(g.get('intent') or 'unknown'),
            plan_summary=_truncate_str(str(g.get('summary') or ''), 500) or '(none)',
            steps_json=_dumps(compact_steps),
            errors_json=_dumps(errs),
        )
        text = text_llm.complete(
            cfg['provider'],
            cfg['model'],
            prompt,
            workspace_id=workspace_id,
            api_model_id=cfg.get('api_model_id'),
            temperature=0.4,
            max_tokens=700,
            opcode='plan_workflow',
            source='agent_result_narrator',
            enable_reasoning=False,
        )
        cleaned = (text or '').strip()
        if cleaned.startswith('```'):
            cleaned = cleaned.strip('`').strip()
            if cleaned.lower().startswith('text'):
                cleaned = cleaned[4:].lstrip()
        if cleaned:
            return cleaned
    except Exception:
        logger.exception('result narrator LLM failed; using fallback')

    return fallback


def apply_result_message(graph: dict[str, Any] | None, message: str) -> dict[str, Any]:
    """Attach the narrated reply onto the workflow graph for UI + persistence."""
    g = dict(graph) if isinstance(graph, dict) else {}
    msg = (message or '').strip()
    g['result_assistant_message'] = msg
    g['assistant_message'] = msg
    return g
