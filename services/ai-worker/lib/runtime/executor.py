"""Workflow runtime — dispatches steps via registry dispatcher only (§15, §34)."""

from __future__ import annotations

import logging
import re
from typing import Any, Callable

from lib.dispatch.dispatcher import dispatch_tool
from lib.dispatch.registry import get_tool
from lib.runtime.account_targets import enrich_create_draft_payload, enrich_schedule_publish_payload
from lib.runtime.cancel import is_workflow_cancelled
from lib.runtime.payload_resolve import _REF_RE, resolve_step_payload
from lib.validation.meta_ads_workflow_rules import validate_meta_ads_step_execution

logger = logging.getLogger(__name__)

_INTERRUPTED = 'Step interrupted — worker stopped before completion.'
_CANCELLED = 'Stopped by user.'
_TRANSIENT_ERR = re.compile(
    r'timeout|timed out|503|502|429|rate limit|temporarily unavailable',
    re.I,
)


def _is_sanitized_media_value(val: Any) -> bool:
    return isinstance(val, str) and (
        val.startswith('[image generated')
        or val.startswith('[video generated')
    )


def _step_output_unusable_on_resume(tool_id: str | None, output: Any) -> bool:
    """Mongo may only store truncated media placeholders — re-run those steps."""
    if not isinstance(output, dict):
        return False
    if tool_id == 'generate_image' and _is_sanitized_media_value(output.get('image')):
        return True
    if tool_id == 'generate_video' and _is_sanitized_media_value(output.get('video')):
        return True
    return False


def _sanitize_step_output(tool_id: str, output: Any) -> Any:
    """Keep workflow step_results small — omit multi-MB base64 blobs from MongoDB."""
    if not isinstance(output, dict):
        return output
    if tool_id in ('generate_image', 'generate_video'):
        out = dict(output)
        for key in ('image', 'video'):
            val = out.get(key)
            if isinstance(val, str) and len(val) > 256:
                out[key] = f'[{key} generated — {len(val)} chars omitted from workflow log]'
        return out
    return output


def public_step_results(results: dict[str, Any]) -> dict[str, Any]:
    """Strip large base64 blobs before persisting workflow step_results to MongoDB."""
    out: dict[str, Any] = {}
    for sid, row in (results or {}).items():
        if not isinstance(row, dict):
            out[sid] = row
            continue
        row_copy = dict(row)
        tool_id = row_copy.get('tool_id') or ''
        if row_copy.get('status') == 'completed' and tool_id:
            row_copy['output'] = _sanitize_step_output(tool_id, row_copy.get('output'))
        out[sid] = row_copy
    return out


def finalize_interrupted_steps(
    results: dict[str, Any],
    *,
    error: str | None = None,
) -> dict[str, Any]:
    """Mark in-flight steps failed when the workflow stops (timeout, crash, reboot, user stop)."""
    msg = error or _INTERRUPTED
    out = dict(results or {})
    for sid, row in list(out.items()):
        if isinstance(row, dict) and row.get('status') == 'running':
            out[sid] = {
                **row,
                'status': 'failed',
                'error': row.get('error') or msg,
            }
    return out


def _deps_satisfied(step: dict, completed: set[str]) -> bool:
    return all(d in completed for d in (step.get('depends_on') or []))


def _optional_skip_missing_media(tool_id: str, payload: dict[str, Any]) -> str | None:
    """Skip optional media tools when upstream script/output did not produce a prompt."""
    if tool_id == 'generate_image':
        if not str(payload.get('prompt') or '').strip():
            return 'No image prompt — upstream image script was skipped or unavailable'
    if tool_id == 'generate_video':
        vp = str(payload.get('video_prompt') or payload.get('prompt') or '').strip()
        if not vp:
            return 'No video prompt — upstream video script was skipped or unavailable'
    return None


_MEDIA_REF_KEYS = frozenset({
    'image', 'image_data_url', 'video', 'video_prompt', 'image_prompt', 'prompt',
})


def _google_publish_blocked(results: dict[str, Any], step: dict[str, Any]) -> str | None:
    """Block Google publish when google_get_account resolved no client customer."""
    tool_id = str(step.get('tool_id') or '')
    if not tool_id.startswith('google_publish_'):
        return None
    for dep in step.get('depends_on') or []:
        row = results.get(dep) or {}
        if row.get('tool_id') != 'google_get_account':
            continue
        output = row.get('output') or {}
        if not isinstance(output, dict):
            continue
        reason = str(output.get('publish_block_reason') or '').strip()
        if reason:
            return reason
        publish_cid = output.get('publish_customer_id')
        if output.get('ok') and not publish_cid:
            return (
                'Google Ads account is not ready for campaign creation. '
                'Reconnect a client (non-manager) account under Accounts.'
            )
    return None


def _tool_output_error(out: Any) -> str | None:
    """Ads and Meta tools often return {ok: false, error: ...} instead of raising."""
    if not isinstance(out, dict):
        return None
    if out.get('ok') is False:
        return str(out.get('error') or 'Tool returned ok: false')
    return None


def _step_result_usable(row: dict[str, Any]) -> bool:
    """Completed steps with ok:false envelopes must be re-run, not resumed."""
    if row.get('status') != 'completed':
        return False
    output = row.get('output')
    if output is None:
        return False
    if _tool_output_error(output):
        return False
    tool_id = row.get('tool_id')
    return not _step_output_unusable_on_resume(tool_id, output)


def _dispatch_with_retry(tool_id: str, payload: dict[str, Any]) -> Any:
    """Max one automatic retry per step on transient Meta/network errors (SPEC)."""
    try:
        return dispatch_tool(tool_id, payload)
    except Exception as exc:
        if tool_id.startswith('meta_') and _TRANSIENT_ERR.search(str(exc)):
            logger.warning('Transient error on %s — retrying once: %s', tool_id, exc)
            return dispatch_tool(tool_id, payload)
        raise


def _is_read_only_graph(workflow: dict[str, Any]) -> bool:
    """True when every step is a non-mutating read (analytics / list / get)."""
    steps = workflow.get('steps') if isinstance(workflow, dict) else None
    if not isinstance(steps, list) or not steps:
        return False
    for step in steps:
        if not isinstance(step, dict):
            return False
        tool_id = str(step.get('tool_id') or '').strip()
        if not tool_id:
            return False
        tool = get_tool(tool_id) or {}
        sec = str(tool.get('side_effect_class') or '')
        if 'mutating' in sec:
            return False
        if sec in ('internal_ai',):
            return False
    return True


def execute_workflow_steps(
    workflow: dict[str, Any],
    *,
    approved: bool,
    workspace_id: str | None = None,
    workflow_mongo_id: str | None = None,
    on_step_event: Callable[[str, str, dict], None] | None = None,
    initial_step_results: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Execute steps in dependency order. Returns step results map.
    Mutating tools are skipped unless approved=True.
    Completed steps from ``initial_step_results`` are reused (no duplicate API spend).
    """
    steps = list(workflow.get('steps') or [])
    approval_gates = set(workflow.get('approval_gates') or [])
    results: dict[str, Any] = {}
    completed: set[str] = set()
    for sid, row in (initial_step_results or {}).items():
        if not isinstance(row, dict):
            continue
        if row.get('status') == 'running':
            # Worker died mid-step — do not resume as complete; re-run on retry.
            continue
        if _step_result_usable(row):
            results[sid] = dict(row)
            completed.add(sid)
    errors: list[str] = []
    context: dict[str, Any] = {'workspace_id': workspace_id}

    def emit(step_id: str, event: str, payload: dict) -> None:
        if on_step_event:
            try:
                on_step_event(step_id, event, {**payload, 'step_results': public_step_results(results)})
            except Exception:
                logger.exception('step event callback failed')

    remaining = list(steps)
    safety = len(remaining) + 2
    while remaining and safety > 0:
        if workflow_mongo_id and is_workflow_cancelled(workflow_mongo_id):
            results = finalize_interrupted_steps(results, error=_CANCELLED)
            errors.append(_CANCELLED)
            return {
                'status': 'cancelled',
                'step_results': public_step_results(results),
                'errors': errors,
            }

        safety -= 1
        progressed = False
        next_remaining = []
        for step in remaining:
            sid = step['step_id']
            if not _deps_satisfied(step, completed):
                next_remaining.append(step)
                continue

            if results.get(sid, {}).get('status') == 'completed':
                progressed = True
                continue

            tool_id = step['tool_id']
            tool = get_tool(tool_id)
            if not tool:
                errors.append(f'{sid}: unknown tool')
                results[sid] = {'status': 'failed', 'error': 'unknown tool'}
                emit(sid, 'step.failed', {'error': 'unknown tool'})
                completed.add(sid)
                progressed = True
                continue

            needs_approval = sid in approval_gates or tool.get('requires_approval_default')
            side_effect = tool.get('side_effect_class') or 'internal'
            is_mutating = side_effect == 'external_mutating' or 'mutating' in side_effect

            if needs_approval and is_mutating and not approved:
                results[sid] = {'status': 'skipped', 'reason': 'awaiting_approval'}
                emit(sid, 'step.skipped', {'reason': 'awaiting_approval'})
                completed.add(sid)
                progressed = True
                continue

            results[sid] = {'status': 'running', 'tool_id': tool_id}
            emit(sid, 'step.running', {'tool_id': tool_id})
            optional_on_failure = bool(tool.get('optional_on_failure'))
            try:
                raw_payload = dict(step.get('payload') or {})
                for key in _MEDIA_REF_KEYS:
                    ref = raw_payload.get(key)
                    if isinstance(ref, str):
                        m = _REF_RE.match(ref.strip())
                        if not m:
                            continue
                        upstream_id = m.group(1)
                        upstream = results.get(upstream_id, {})
                        if upstream.get('status') in ('failed', 'skipped'):
                            upstream_tool = get_tool(upstream.get('tool_id') or '')
                            if not (upstream_tool and upstream_tool.get('optional_on_failure')):
                                raise ValueError(
                                    f'Cannot resolve {ref} — upstream {upstream_id} failed'
                                )
                try:
                    payload = resolve_step_payload(raw_payload, results, context)
                except ValueError as ve:
                    raise ve
                if workspace_id and not payload.get('workspace_id'):
                    payload['workspace_id'] = workspace_id
                if tool_id.startswith(('google_', 'meta_')):
                    from tools.ads._resolve import inherit_ads_account_context

                    payload = inherit_ads_account_context(
                        payload,
                        workflow=workflow,
                        steps=steps,
                    )
                if workspace_id and tool_id == 'create_draft_post':
                    payload = enrich_create_draft_payload(payload, workspace_id)
                if workspace_id and tool_id in ('schedule_post', 'publish_post'):
                    payload = enrich_schedule_publish_payload(payload, workspace_id)
                if tool_id.startswith('meta_'):
                    validate_meta_ads_step_execution(
                        tool_id,
                        payload,
                        workflow_steps=steps,
                        step_id=sid,
                        completed_step_results=results,
                        intent=str(workflow.get('intent') or ''),
                    )
                publish_block = _google_publish_blocked(results, step)
                if publish_block:
                    raise ValueError(publish_block)
                if optional_on_failure:
                    skip_reason = _optional_skip_missing_media(tool_id, payload)
                    if skip_reason:
                        results[sid] = {
                            'status': 'skipped',
                            'reason': 'optional_step_failed',
                            'error': skip_reason,
                            'tool_id': tool_id,
                        }
                        emit(sid, 'step.skipped', {
                            'reason': skip_reason,
                            'tool_id': tool_id,
                            'error': skip_reason,
                        })
                        completed.add(sid)
                        progressed = True
                        continue
                out = _dispatch_with_retry(tool_id, payload)
                tool_err = _tool_output_error(out)
                if tool_err:
                    raise ValueError(tool_err)
                sanitized = _sanitize_step_output(tool_id, out)
                results[sid] = {
                    'status': 'completed',
                    'output': sanitized,
                    'tool_id': tool_id,
                }
                emit(sid, 'step.completed', {'tool_id': tool_id, 'output': sanitized})
            except Exception as exc:
                logger.exception('step %s failed', sid)
                if optional_on_failure:
                    results[sid] = {
                        'status': 'skipped',
                        'reason': 'optional_step_failed',
                        'error': str(exc),
                        'tool_id': tool_id,
                    }
                    emit(sid, 'step.skipped', {
                        'reason': 'optional_step_failed',
                        'error': str(exc),
                        'tool_id': tool_id,
                    })
                else:
                    errors.append(f'{sid}: {exc}')
                    results[sid] = {'status': 'failed', 'error': str(exc), 'tool_id': tool_id}
                    emit(sid, 'step.failed', {'error': str(exc)})

            completed.add(sid)
            progressed = True

        remaining = next_remaining
        if not progressed and remaining:
            errors.append('deadlock: unsatisfied dependencies')
            break

    status = 'failed' if errors else 'completed'
    # Multi-account analytics: one Meta account may OAuth-fail while another
    # returns data — treat as completed so the UI does not look fully broken.
    if errors and _is_read_only_graph(workflow):
        any_ok = any(
            isinstance(r, dict) and r.get('status') == 'completed'
            for r in results.values()
        )
        if any_ok:
            status = 'completed'
    if not errors and any(
        isinstance(r, dict)
        and r.get('status') == 'skipped'
        and r.get('reason') == 'awaiting_approval'
        for r in results.values()
    ):
        status = 'awaiting_approval'

    return {
        'status': status,
        'step_results': public_step_results(results),
        'errors': errors,
    }
