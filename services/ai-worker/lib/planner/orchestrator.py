"""
Orchestrating LLM — intent → workflow specification.

Keyword rules are fallback only when the model is unavailable or low confidence.
Specs + compile layers remain the source of truth for execution.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Literal

from lib.planner.workflow_spec import WORKFLOW_REGISTRY, orchestrator_workflow_catalog

logger = logging.getLogger(__name__)

Confidence = Literal['high', 'low']


@dataclass
class WorkflowIntent:
    workflow_id: str
    confidence: Confidence
    understood_summary: str = ''


def workflow_intent_from_ctx(ctx: dict[str, Any]) -> WorkflowIntent | None:
    """Reuse orchestrator result from planner when already classified."""
    wf = str(ctx.get('workflow_intent') or '').strip()
    if not wf:
        return None
    conf = str(ctx.get('workflow_intent_confidence') or 'low').strip().lower()
    return WorkflowIntent(
        workflow_id=wf,
        confidence='high' if conf == 'high' else 'low',
        understood_summary=str(ctx.get('workflow_intent_summary') or '').strip(),
    )


_VALID_WORKFLOW_IDS = frozenset(WORKFLOW_REGISTRY.keys()) | frozenset({
    'google_ads_mutate',
    'meta_ads_mutate',
    'unknown',
})


def classify_workflow_intent_with_planner(
    *,
    workspace_id: str | None,
    message: str,
    conversation_history: list[dict[str, Any]] | None = None,
) -> WorkflowIntent | None:
    """Marketing Assistant classifies user intent to a workflow id."""
    try:
        from lib.ai_workspace_config import get_planner_config
        from lib.llm import text as text_llm
        from lib.llm.json_utils import parse_json_text

        cfg = get_planner_config(workspace_id)
    except Exception:
        return None

    lines: list[str] = []
    for msg in conversation_history or []:
        role = str(msg.get('role') or 'user')
        content = str(msg.get('content') or '').strip()
        if content:
            lines.append(f'{role}: {content}')
    current = (message or '').strip()
    if current:
        lines.append(f'user: {current}')
    convo = '\n'.join(lines[-14:])

    workflow_list = orchestrator_workflow_catalog()

    llm_prompt = f"""You classify the user's intent for a marketing automation assistant.

Available workflows:
{workflow_list}

Conversation:
{convo}

Return JSON only:
{{
  "workflow_id": "one of the ids above",
  "confidence": "high" | "low",
  "understood_summary": "one sentence"
}}

Use the most specific workflow (e.g. google_search_create, google_shopping_create, meta_leads_create).
Use meta_campaign_create only when platform is Meta but objective is unclear.
Use high confidence only when intent is clear."""

    try:
        raw = text_llm.complete(
            cfg['provider'],
            cfg['model'],
            llm_prompt,
            workspace_id=workspace_id,
            temperature=0.1,
            max_tokens=250,
            api_model_id=cfg.get('api_model_id'),
            feature_id='planner',
            opcode='plan_workflow',
            source='workflow_intent_classifier',
            record_usage=True,
        )
        parsed = parse_json_text(raw, {})
        if not isinstance(parsed, dict):
            return None
        wf = str(parsed.get('workflow_id') or '').strip()
        conf = str(parsed.get('confidence') or 'low').strip().lower()
        if wf not in _VALID_WORKFLOW_IDS:
            return None
        return WorkflowIntent(
            workflow_id=wf,
            confidence='high' if conf == 'high' else 'low',
            understood_summary=str(parsed.get('understood_summary') or '').strip(),
        )
    except Exception as exc:
        logger.warning('workflow_intent_classifier failed: %s', exc)
        return None


def should_route_ads_spec(
    *,
    message: str,
    ctx: dict[str, Any],
    workflow_intent: WorkflowIntent | None,
    conversation_history: list[dict[str, Any]] | None,
    ads_followup: bool = False,
    ads_collecting: bool = False,
) -> bool:
    """Route to ads spec path — orchestrator, session, or obvious ads create request."""
    if is_ads_workflow_intent(workflow_intent):
        return True
    if ads_followup or ads_collecting:
        return True
    try:
        from lib.planner.ads_fallback import detect_ads_platform, is_actionable_ads_request
        from lib.planner.intent_router import message_mentions_ads

        if is_actionable_ads_request(message) or message_mentions_ads(message):
            return True
        if detect_ads_platform(message, ctx) != 'unknown':
            return True
    except Exception:
        pass
    return False


def pin_ads_workflow_intent_for_message(
    message: str,
    ctx: dict[str, Any],
) -> WorkflowIntent | None:
    """When orchestrator is unavailable, infer platform for ads spec routing."""
    try:
        from lib.planner.ads_fallback import detect_ads_platform

        m = (message or '').lower()
        platform = detect_ads_platform(message, ctx)
        if platform == 'google_ads' or (
            'google' in m and any(k in m for k in ('ad', 'advertising', 'campaign', 'search'))
        ):
            return WorkflowIntent('google_campaign_create', 'high', '')
        if platform == 'meta_ads' or (
            'meta' in m and any(k in m for k in ('ad', 'advertising', 'campaign'))
        ):
            return WorkflowIntent('meta_campaign_create', 'high', '')
    except Exception:
        pass
    return None


def is_ads_workflow_intent(intent: WorkflowIntent | None) -> bool:
    """True when the orchestrator routed to an ads-related workflow (any confidence)."""
    if not intent:
        return False
    wf = intent.workflow_id
    if wf in ('unknown', 'social_post_create', 'landing_page_create'):
        return False
    return (
        wf.startswith('google_')
        or wf.startswith('meta_')
        or wf in ('google_ads_mutate', 'meta_ads_mutate')
    )


def resolve_ads_mode_from_intent(intent: WorkflowIntent | None) -> str | None:
    """Map orchestrator workflow_id → ads router mode (keyword fallback when None)."""
    if not intent:
        return None
    wf = intent.workflow_id
    if wf.endswith('_create'):
        return 'create'
    if wf in ('google_ads_analytics', 'meta_ads_analytics'):
        return 'report'
    if wf == 'google_ads_mutate':
        m = (intent.understood_summary or '').lower()
        if any(k in m for k in ('audience', 'remarketing', 'user list')):
            return 'audience'
        if any(k in m for k in ('schedule', 'daypart')):
            return 'schedule'
        if any(k in m for k in ('optimize', 'bid', 'negative keyword')):
            return 'optimize'
        if any(k in m for k in ('pause', 'stop')):
            return 'pause'
        if any(k in m for k in ('list', 'show')):
            return 'list'
        return 'create'
    if wf == 'meta_ads_mutate':
        if 'pause' in (intent.understood_summary or '').lower():
            return 'pause'
        if 'list' in (intent.understood_summary or '').lower():
            return 'list'
        return 'create'
    return None


def resolve_ads_platform_from_intent(
    intent: WorkflowIntent | None,
    message: str,
    ctx: dict[str, Any],
) -> str | None:
    """Override keyword platform detection when orchestrator picked an ads workflow."""
    if not intent:
        return None
    wf = intent.workflow_id
    if wf.startswith('google_'):
        return 'google_ads'
    if wf.startswith('meta_'):
        return 'meta_ads'
    if wf == 'google_ads_mutate':
        return 'google_ads'
    if wf == 'meta_ads_mutate':
        return 'meta_ads'
    return None
