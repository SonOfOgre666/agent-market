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
from lib.planner.ads_fallback import (
    is_ads_clarification_followup,
    merge_conversation_attachments,
    resolve_ads_planning_message,
    route_ads_workflow,
)
from lib.planner.ads_session import is_ads_collection_active, resolve_ads_session
from lib.planner.attached_media import (
    format_attached_media_block,
    reconcile_attached_media_steps,
)
from lib.planner.orchestrator import (
    classify_workflow_intent_with_planner,
    pin_ads_workflow_intent_for_message,
    should_route_ads_spec,
)
from lib.planner.intent_router import (
    format_route_hint,
    route_planner_intent,
    route_workflow_intent,
)
from lib.planner.social_fallback import (
    build_fallback_social_workflow,
    detect_dual_publish_schedule,
    detect_outcome_mode,
    expected_fallback_step_count,
    is_actionable_social_request,
    normalize_planner_payload,
    parse_post_count,
)
from lib.planner.landing_page_fallback import (
    build_fallback_landing_page_workflow,
    is_actionable_landing_page_request,
)
from lib.planner.seo_fallback import (
    build_fallback_seo_workflow,
    is_actionable_seo_request,
)
from lib.planner.intent_router import message_mentions_ads
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
    parsed = normalize_planner_payload(parsed)
    if media:
        parsed = reconcile_attached_media_steps(parsed, media)

    if is_actionable_social_request(user_message) and not parsed.get('steps'):
        logger.warning('Planner returned no steps for actionable social request — using fallback graph')
        parsed = build_fallback_social_workflow(user_message, ctx)

    if is_actionable_social_request(user_message):
        n_posts = parse_post_count(user_message)
        if n_posts >= 2:
            dual, _ = detect_dual_publish_schedule(user_message)
            mode = detect_outcome_mode(user_message)
            min_steps = expected_fallback_step_count(
                post_count=n_posts,
                mode=mode,
                dual_publish_schedule=dual,
                max_steps=max_steps,
            )
            if len(parsed.get('steps') or []) < min_steps:
                logger.warning(
                    'Planner returned %s steps for %s-post request (need %s, max %s) — using fallback',
                    len(parsed.get('steps') or []),
                    n_posts,
                    min_steps,
                    max_steps,
                )
                parsed = build_fallback_social_workflow(user_message, ctx)

    workflow_intent_id = (ctx.get('workflow_intent') or '') if ctx else ''
    if workflow_intent_id.startswith(('google_', 'meta_')) and not parsed.get('steps'):
        logger.warning('Planner returned no steps for ads workflow — routing to ads spec')
        parsed = route_ads_workflow(
            resolve_ads_planning_message(user_message, conversation_history),
            ctx,
        )

    if not parsed.get('steps'):
        try:
            from lib.planner.ads_fallback import is_actionable_ads_request

            if is_actionable_ads_request(user_message):
                logger.warning('Actionable ads request with no steps — routing to ads spec')
                parsed = route_ads_workflow(
                    resolve_ads_planning_message(user_message, conversation_history),
                    ctx,
                )
        except Exception:
            pass

    if not parsed.get('steps') and is_ads_clarification_followup(user_message, conversation_history):
        planning_message = resolve_ads_planning_message(user_message, conversation_history)
        logger.info('Ads clarification follow-up — merged planning message (%s chars)', len(planning_message))
        parsed = route_ads_workflow(planning_message, ctx)

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
    phase = parsed.get('meta_setup_phase')
    result = validate_workflow_graph(parsed, max_steps=max_steps)
    if phase:
        result['meta_setup_phase'] = phase
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
    """
    planner_cfg = get_planner_config(workspace_id)
    planner_provider = planner_cfg['provider']
    planner_model = planner_cfg['model']
    max_steps = int(planner_cfg.get('max_workflow_steps') or 10)

    media = merge_conversation_attachments(attached_media, conversation_history)
    planning_message = resolve_ads_planning_message(user_message, conversation_history)
    ctx = build_planner_context(workspace_id, planning_message, attached_media=media)
    ctx['max_workflow_steps'] = max_steps
    ctx['conversation_history'] = list(conversation_history or [])

    from lib.planner.intent_router import is_conversational_chat

    if (
        is_conversational_chat(planning_message)
        and not media
        and not is_ads_collection_active(conversation_history)
    ):
        from lib.planner.agent_dialogue import render_agent_message

        assistant = render_agent_message(
            workspace_id=workspace_id,
            phase='acknowledge',
            workflow_label='Marketing Assistant',
            facts={'user_message': planning_message},
            extra_instructions=(
                'This is casual chat, not a workflow request. Greet the user briefly and explain you can help '
                'with social posts, Meta and Google Ads campaigns, landing pages, SEO tooling, and ad analytics. '
                'Do not mention workflows, approval, or planning steps.'
            ),
        )
        return {
            'intent': 'informational',
            'chat_only': True,
            'summary': assistant,
            'assistant_message': assistant,
            'steps': [],
            'dependencies': [],
            'parallel_groups': [],
            'approval_gates': [],
            'requires_approval': False,
        }

    ads_collecting = is_ads_collection_active(conversation_history)

    workflow_intent = None
    if ads_collecting:
        session = resolve_ads_session(conversation_history)
        workflow_intent = session.pinned_intent
    if not ads_collecting:
        workflow_intent = pin_ads_workflow_intent_for_message(planning_message, ctx)
    if not workflow_intent:
        workflow_intent = classify_workflow_intent_with_planner(
            workspace_id=workspace_id,
            message=planning_message,
            conversation_history=conversation_history,
        )
    if not workflow_intent:
        workflow_intent = pin_ads_workflow_intent_for_message(planning_message, ctx)

    if workflow_intent:
        ctx['workflow_intent'] = workflow_intent.workflow_id
        ctx['workflow_intent_summary'] = workflow_intent.understood_summary
        ctx['workflow_intent_confidence'] = workflow_intent.confidence

    route = route_planner_intent(planning_message, ctx)
    logger.info(
        'Planner route=%s workflow_intent=%s for message_len=%s',
        route,
        workflow_intent.workflow_id if workflow_intent else None,
        len(user_message or ''),
    )

    ads_followup = is_ads_clarification_followup(user_message, conversation_history)

    if route == 'landing_page' or (
        is_actionable_landing_page_request(planning_message)
        and not message_mentions_ads(planning_message)
        and not is_actionable_social_request(planning_message)
    ):
        lp_graph = build_fallback_landing_page_workflow(planning_message, ctx)
        if lp_graph.get('steps'):
            logger.info('Landing page workflow — execute graph (%s steps)', len(lp_graph['steps']))
            return _finalize_graph(
                lp_graph,
                user_message=user_message,
                ctx=ctx,
                max_steps=max_steps,
                media=media,
                conversation_history=conversation_history,
            )

    if route == 'seo_marketing' or (
        is_actionable_seo_request(planning_message)
        and not message_mentions_ads(planning_message)
        and not is_actionable_social_request(planning_message)
        and not is_actionable_landing_page_request(planning_message)
    ):
        seo_graph = build_fallback_seo_workflow(planning_message, ctx)
        if seo_graph.get('steps'):
            logger.info('SEO workflow — execute graph (%s steps)', len(seo_graph['steps']))
            return _finalize_graph(
                seo_graph,
                user_message=user_message,
                ctx=ctx,
                max_steps=max_steps,
                media=media,
                conversation_history=conversation_history,
            )
        if seo_graph.get('chat_only'):
            return seo_graph

    if should_route_ads_spec(
        message=planning_message,
        ctx=ctx,
        workflow_intent=workflow_intent,
        conversation_history=conversation_history,
        ads_followup=ads_followup,
        ads_collecting=ads_collecting,
    ):
        ads_graph = route_ads_workflow(planning_message, ctx)
        if ads_graph.get('steps'):
            logger.info('Ads workflow spec — execute graph (%s steps)', len(ads_graph['steps']))
            return _finalize_graph(
                ads_graph,
                user_message=user_message,
                ctx=ctx,
                max_steps=max_steps,
                media=media,
                conversation_history=conversation_history,
            )
        if not ads_graph.get('steps'):
            from lib.planner.chat_only import is_chat_only_graph

            if is_chat_only_graph(ads_graph):
                ads_graph = {**ads_graph, 'chat_only': True}
            return ads_graph

    catalog = tool_catalog_for_planner(route)
    system = _load_system_prompt()
    route_hint = format_route_hint(route)
    suggested_intent = route_workflow_intent(route)

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
        f'ROUTING (pre-classified): route={route}; preferred intent={suggested_intent}.\n'
        f'{route_hint}\n\n'
        f'WORKSPACE LIMIT: Maximum workflow steps = {max_steps}. '
        f'Never plan more than {max_steps} steps.\n\n'
        f'TOOL CATALOG ({len(catalog)} tools for this route):\n{catalog_block}\n\n'
        f'WORKSPACE CONTEXT:\n{format_context_block(ctx)}\n\n'
        f'{attached_block}'
        f'{history_block}\n\n'
        f'USER REQUEST:\n{user_message.strip()}\n\n'
        'Respond with the workflow JSON object only.'
    )

    raw = text_llm.complete(
        planner_provider,
        planner_model,
        user_block,
        workspace_id=workspace_id,
        temperature=0.35,
        max_tokens=2048,
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
