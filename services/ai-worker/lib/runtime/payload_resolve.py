"""Resolve step output references inside workflow step payloads."""

from __future__ import annotations

import copy
import re
from typing import Any

from lib.dispatch.registry import get_tool

_REF_RE = re.compile(
    r'^\$?(step_\d+)\.output(?:\.([a-zA-Z0-9_.\[\]]+))?$'
)


def _optional_upstream(step_results: dict[str, Any], step_id: str) -> bool:
    step = step_results.get(step_id) or {}
    tool_id = step.get('tool_id')
    if not tool_id:
        return False
    tool = get_tool(tool_id)
    return bool(tool and tool.get('optional_on_failure'))


def _optional_upstream_unresolved(step_results: dict[str, Any], step_id: str) -> bool:
    step = step_results.get(step_id) or {}
    return step.get('status') in ('failed', 'skipped') and _optional_upstream(step_results, step_id)


def _upstream_failure_message(step: dict[str, Any], sid: str, value: str) -> str:
    err = step.get('error')
    if err:
        return f'{sid} failed — cannot resolve {value}: {err}'
    out = step.get('output')
    if isinstance(out, dict):
        out_err = out.get('error')
        if out_err and out.get('ok') is False:
            return f'{sid} failed — cannot resolve {value}: {out_err}'
    return f'{sid} is not completed — cannot resolve {value}'


def _get_path(obj: Any, path: str) -> Any:
    if not path:
        return obj
    cur = obj
    for part in path.replace('[', '.').replace(']', '').split('.'):
        if not part:
            continue
        if isinstance(cur, dict):
            cur = cur.get(part)
        elif isinstance(cur, list) and part.isdigit():
            cur = cur[int(part)]
        else:
            return None
    return cur


def resolve_payload_value(value: Any, step_results: dict[str, Any], context: dict[str, Any]) -> Any:
    if isinstance(value, str):
        m = _REF_RE.match(value.strip())
        if m:
            sid, path = m.group(1), m.group(2) or ''
            step = step_results.get(sid) or {}
            if step.get('status') != 'completed':
                if _optional_upstream_unresolved(step_results, sid):
                    return None
                raise ValueError(_upstream_failure_message(step, sid, value))
            out = step.get('output') or {}
            if isinstance(out, dict) and out.get('ok') is False:
                if _optional_upstream(step_results, sid):
                    return None
                raise ValueError(_upstream_failure_message(step, sid, value))
            resolved = _get_path(out, path) if path else out
            if resolved is None and path:
                if _optional_upstream(step_results, sid):
                    return None
                if isinstance(out, dict) and out.get('error'):
                    raise ValueError(_upstream_failure_message(step, sid, value))
                raise ValueError(f'Missing {value} in {sid} output')
            return resolved
        if value.strip() == '$workflow.workspace_id':
            return context.get('workspace_id')
        return value
    if isinstance(value, list):
        return [resolve_payload_value(v, step_results, context) for v in value]
    if isinstance(value, dict):
        return {k: resolve_payload_value(v, step_results, context) for k, v in value.items()}
    return value


def resolve_step_payload(
    payload: dict[str, Any] | None,
    step_results: dict[str, Any],
    context: dict[str, Any],
) -> dict[str, Any]:
    if not payload:
        return {}
    return resolve_payload_value(copy.deepcopy(payload), step_results, context)
