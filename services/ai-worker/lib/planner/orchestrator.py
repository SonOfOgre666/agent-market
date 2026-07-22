"""
Orchestrating LLM — legacy soft workflow_id classifier.

Not used on the live planner path (``agents.planner.plan_workflow``). Kept for
tests / reference only. Do not re-wire into the planner without an explicit
product decision.
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


