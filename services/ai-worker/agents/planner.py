"""Planner agent — LLM workflow generation only (no execution)."""

from __future__ import annotations

import json
import logging
from typing import Any

from lib.prompt_loader import load_prompt

from lib.dispatch.registry import tool_catalog_for_planner
from lib.ai_workspace_config import get_planner_config
from lib.llm.json_utils import parse_json_text
from lib.llm import text as text_llm
from lib.memory.context import build_planner_context, format_context_block
from lib.planner.ads_helpers import (
    merge_conversation_attachments,
    resolve_ads_planning_message,
)
from lib.planner.attached_media import (
    format_attached_media_block,
    reconcile_attached_media_steps,
)
from lib.planner.social_helpers import (
    normalize_planner_payload,
)
from lib.validation.workflow_graph import validate_workflow_graph

logger = logging.getLogger(__name__)


def _load_system_prompt() -> str:
    return load_prompt('planner/system.md')


def _finalize_graph(
    parsed: dict,
    *,
    user_message: str,
    ctx: dict,
    max_steps: int,
    media: list[dict[str, str]],
    raw_fallback: str = '',
    conversation_history: list[dict[str, Any]] | None = None,
) -> dict:
    """Validate/reconcile the planner LLM graph — never replace it with heuristic workflows."""
    _ = (user_message, conversation_history)
    parsed = normalize_planner_payload(parsed)
    if media:
        parsed = reconcile_attached_media_steps(parsed, media)

    if parsed.get('intent') == 'informational' and not parsed.get('steps'):
        summary = (parsed.get('assistant_message') or parsed.get('summary') or raw_fallback[:500]).strip()
        from lib.planner.chat_only import is_chat_only_graph

        graph = {
            'intent': 'informational',
            'summary': summary,
            'assistant_message': summary,
            'steps': [],
            'dependencies': [],
            'parallel_groups': [],
            'approval_gates': [],
            'requires_approval': False,
        }
        if is_chat_only_graph(graph):
            graph['chat_only'] = True
        for key in (
            'collection_phase',
            'meta_setup_phase',
            'google_setup_phase',
            'meta_compiled',
            'google_compiled',
            'execute_plan',
        ):
            if parsed.get(key) is not None:
                graph[key] = parsed[key]
        return graph

    if not parsed.get('steps'):
        summary = (
            (parsed.get('assistant_message') or parsed.get('summary') or raw_fallback[:500] or '').strip()
            or 'I could not plan workflow steps for that message. Include the full request in one message.'
        )
        from lib.planner.chat_only import is_chat_only_graph

        graph = {
            'intent': 'informational',
            'summary': summary,
            'assistant_message': summary,
            'steps': [],
            'dependencies': [],
            'parallel_groups': [],
            'approval_gates': [],
            'requires_approval': False,
        }
        if is_chat_only_graph(graph):
            graph['chat_only'] = True
        return graph

    if media:
        parsed = reconcile_attached_media_steps(parsed, media)
    result = validate_workflow_graph(parsed, max_steps=max_steps)
    for key in (
        'meta_setup_phase',
        'google_setup_phase',
        'meta_compiled',
        'google_compiled',
        'collection_phase',
        'execute_plan',
    ):
        if parsed.get(key) is not None:
            result[key] = parsed[key]
    return result


def plan_workflow(
    *,
    workspace_id: str,
    user_message: str,
    conversation_history: list[dict[str, str]] | None = None,
    attached_media: list[dict[str, str]] | None = None,
) -> dict:
    """
    Run planner LLM and return validated workflow graph + metadata.
    Raises ValueError on validation failure; RuntimeError on LLM failure.

    Tool choice is guided by prompts + full catalog + workspace context only.
    No keyword routes and no soft workflow_intent classifier.
    """
    planner_cfg = get_planner_config(workspace_id)
    planner_provider = planner_cfg['provider']
    planner_model = planner_cfg['model']
    max_steps = int(planner_cfg.get('max_workflow_steps') or 10)

    media = merge_conversation_attachments(attached_media, conversation_history)
    # Merge short ads follow-ups into one planning prompt (context for the LLM only).
    planning_message = resolve_ads_planning_message(user_message, conversation_history)
    ctx = build_planner_context(workspace_id, planning_message, attached_media=media)
    ctx['max_workflow_steps'] = max_steps
    ctx['conversation_history'] = list(conversation_history or [])

    logger.info('Planner start message_len=%s', len(user_message or ''))

    catalog = tool_catalog_for_planner('general')
    system = _load_system_prompt()

    history_block = ''
    if conversation_history:
        lines = []
        for m in conversation_history[-10:]:
            role = m.get('role') or 'user'
            content = (m.get('content') or '').strip()
            if content:
                lines.append(f'{role}: {content}')
        if lines:
            history_block = '\n\nCONVERSATION HISTORY:\n' + '\n'.join(lines)

    attached_block = format_attached_media_block(media)

    catalog_block = json.dumps(catalog, indent=2) if catalog else '[]'
    user_block = (
        f'{system}\n\n'
        f'WORKSPACE LIMIT: Maximum workflow steps = {max_steps}. '
        f'Never plan more than {max_steps} steps.\n\n'
        f'TOOL CATALOG ({len(catalog)} tools — pick the smallest set that answers the user):\n'
        f'{catalog_block}\n\n'
        f'WORKSPACE CONTEXT:\n{format_context_block(ctx)}\n\n'
        f'{attached_block}'
        f'{history_block}\n\n'
        f'USER REQUEST:\n{planning_message.strip()}\n\n'
        'Respond with the workflow JSON object only.'
    )

    raw = text_llm.complete(
        planner_provider,
        planner_model,
        user_block,
        workspace_id=workspace_id,
        temperature=0.35,
        max_tokens=3072,
        api_model_id=planner_cfg.get('api_model_id'),
        feature_id='planner',
        opcode='planner',
        source='agent',
        enable_reasoning=False,
    )

    parsed = parse_json_text(raw, {})
    if not isinstance(parsed, dict):
        raise ValueError('Planner did not return a JSON object')

    return _finalize_graph(
        parsed,
        user_message=user_message,
        ctx=ctx,
        max_steps=max_steps,
        media=media,
        raw_fallback=raw,
        conversation_history=conversation_history,
    )
