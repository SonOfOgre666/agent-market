"""
Ads multi-turn session — detect active collection without brittle keyword routing.

Uses prior workflow graph metadata (when available) plus structural signals on
assistant replies. Follow-up user messages are merged into one planning prompt.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any, Literal

from lib.planner.orchestrator import WorkflowIntent

logger = logging.getLogger(__name__)

AdsPlatform = Literal['meta_ads', 'google_ads', 'unknown']


@dataclass(frozen=True)
class AdsSession:
    active: bool
    platform: AdsPlatform = 'unknown'
    workflow_id: str | None = None
    pinned_intent: WorkflowIntent | None = None


_APPROVE_RE = re.compile(r'^\s*(APPROVE|yes,?\s*create it|create campaign)\s*$', re.I)
_PAGE_REPLY_RE = re.compile(
    r'\b(first|second|third|both|1st|2nd|3rd)\s*(page)?\b|\bpage\s+[12]\b',
    re.I,
)


def _last_assistant_message(history: list[dict[str, Any]]) -> str:
    for msg in reversed(history):
        if msg.get('role') == 'assistant':
            return str(msg.get('content') or '')
    return ''


def _last_assistant_workflow_id(history: list[dict[str, Any]]) -> str | None:
    for msg in reversed(history):
        if msg.get('role') == 'assistant':
            wf = str(msg.get('workflow_id') or '').strip()
            if wf:
                return wf
    return None


def load_workflow_graph(workflow_id: str | None) -> dict[str, Any]:
    if not workflow_id:
        return {}
    try:
        from lib import worker_api

        if not worker_api.configured():
            return {}
        wf = worker_api.get_agent_workflow(workflow_id)
        graph = wf.get('graph')
        return graph if isinstance(graph, dict) else {}
    except Exception as exc:
        logger.debug('ads_session load workflow %s: %s', workflow_id, exc)
        return {}


def is_ads_collection_graph(graph: dict[str, Any] | None) -> bool:
    """True when the stored workflow is waiting for user input before execute."""
    if not graph:
        return False
    phase = graph.get('meta_setup_phase') or graph.get('google_setup_phase')
    if phase == 'ready_for_review':
        return False
    if graph.get('collection_phase'):
        return True
    summary = (graph.get('summary') or '').lower()
    if 'collect campaign details' in summary:
        return True
    if 'collect google campaign details' in summary:
        return True
    if phase == 'discovery':
        return True
    if graph.get('steps'):
        return False
    if graph.get('intent') == 'informational' and graph.get('requires_approval') is not True:
        if graph.get('meta_compiled') or graph.get('google_compiled'):
            return False
        if 'meta' in summary or 'google' in summary:
            if 'review' not in summary:
                return True
    return False


def _platform_from_graph(graph: dict[str, Any]) -> AdsPlatform:
    summary = (graph.get('summary') or '').lower()
    if graph.get('meta_setup_phase') or graph.get('meta_compiled') or 'meta' in summary:
        return 'meta_ads'
    if graph.get('google_setup_phase') or graph.get('google_compiled') or 'google' in summary:
        return 'google_ads'
    return 'unknown'


def _pinned_intent_from_graph(graph: dict[str, Any]) -> WorkflowIntent | None:
    platform = _platform_from_graph(graph)
    if platform == 'meta_ads':
        return WorkflowIntent(
            workflow_id='meta_campaign_create',
            confidence='high',
            understood_summary=str(graph.get('summary') or ''),
        )
    if platform == 'google_ads':
        compiled = graph.get('google_compiled') or {}
        ctype = str(compiled.get('campaign_type') or '').strip()
        wf = f'google_{ctype}_create' if ctype else 'google_campaign_create'
        return WorkflowIntent(workflow_id=wf, confidence='high', understood_summary=str(graph.get('summary') or ''))
    return None


def is_assistant_collecting_ads_fields(content: str) -> bool:
    """
    Thin structural fallback when workflow graph metadata is missing.

    Prefer ``is_ads_collection_graph`` / ``collection_phase`` on the stored graph.
    This only checks: asks a question + looks like an ads setup turn (not phrase lists of fields).
    """
    c = (content or '').strip()
    if not c:
        return False

    from lib.planner.google_campaign_spec import is_google_review_message
    from lib.planner.meta_campaign_spec import is_meta_review_message

    if is_meta_review_message(c) or is_google_review_message(c):
        return False

    lower = c.lower()
    if 'type approve to continue' in lower and ('review' in lower or 'estimated max' in lower):
        return False

    asks_question = (
        '?' in c
        or 'still need' in lower
        or 'need ' in lower
        or 'which ' in lower
        or 'provide' in lower
    )
    if not asks_question:
        return False

    ads_context = any(
        token in lower
        for token in (
            'meta ads',
            'meta campaign',
            'facebook page',
            'google ads',
            'google campaign',
            'ad account',
            'campaign objective',
            'daily budget',
            'collect campaign',
        )
    )
    return ads_context


def is_ads_collection_active(conversation_history: list[dict[str, Any]] | None) -> bool:
    """True when the last ads workflow is still collecting fields (graph metadata first)."""
    history = list(conversation_history or [])
    if not history:
        return False

    graph = load_workflow_graph(_last_assistant_workflow_id(history))
    if is_ads_collection_graph(graph):
        return True

    for msg in reversed(history):
        if msg.get('role') != 'assistant':
            continue
        content = str(msg.get('content') or '')
        from lib.planner.google_campaign_spec import is_google_review_message
        from lib.planner.meta_campaign_spec import is_meta_review_message

        if is_meta_review_message(content) or is_google_review_message(content):
            return False

        wf_id = str(msg.get('workflow_id') or '').strip()
        if wf_id:
            g = load_workflow_graph(wf_id)
            if is_ads_collection_graph(g):
                return True
            # Graph present but not collecting — stop scanning older turns
            if g:
                return False

        # Fallback only when no workflow graph is attached to this assistant turn
        if not wf_id and is_assistant_collecting_ads_fields(content):
            return True
        # First assistant with content ends the scan for fallback
        if content:
            return False
    return False


def resolve_ads_session(
    conversation_history: list[dict[str, Any]] | None,
) -> AdsSession:
    history = list(conversation_history or [])
    if not history:
        return AdsSession(active=False)

    graph = load_workflow_graph(_last_assistant_workflow_id(history))
    active = is_ads_collection_graph(graph) or is_assistant_collecting_ads_fields(
        _last_assistant_message(history),
    )
    if not active:
        return AdsSession(active=False)

    platform: AdsPlatform = _platform_from_graph(graph) if graph else 'unknown'
    if platform == 'unknown':
        assistant = _last_assistant_message(history).lower()
        if 'meta' in assistant or 'facebook page' in assistant:
            platform = 'meta_ads'
        elif 'google' in assistant:
            platform = 'google_ads'
        else:
            for msg in history:
                if msg.get('role') != 'user':
                    continue
                text = str(msg.get('content') or '').lower()
                if 'meta' in text and any(k in text for k in ('ad', 'campaign', 'advertising')):
                    platform = 'meta_ads'
                    break
                if 'google' in text and 'ad' in text:
                    platform = 'google_ads'
                    break

    pinned = _pinned_intent_from_graph(graph) if graph else None
    if not pinned and platform == 'meta_ads':
        pinned = WorkflowIntent('meta_campaign_create', 'high', '')
    elif not pinned and platform == 'google_ads':
        pinned = WorkflowIntent('google_campaign_create', 'high', '')

    return AdsSession(
        active=True,
        platform=platform,
        workflow_id=_last_assistant_workflow_id(history),
        pinned_intent=pinned,
    )


def merge_ads_conversation_user_messages(
    user_message: str,
    conversation_history: list[dict[str, Any]] | None,
) -> str:
    """Combine user turns during an active ads collection session."""
    current = (user_message or '').strip()
    history = list(conversation_history or [])
    if not is_ads_collection_active(history):
        return current

    chunks: list[str] = []
    for msg in history:
        if msg.get('role') != 'user':
            continue
        text = str(msg.get('content') or '').strip()
        if not text:
            continue
        if _APPROVE_RE.match(text):
            continue
        if text not in chunks:
            chunks.append(text)

    if current and (not chunks or chunks[-1] != current):
        chunks.append(current)

    return '\n\n'.join(chunks).strip() if chunks else current


def is_short_ads_followup_reply(user_message: str) -> bool:
    """True for typical collection replies (page, objective, budget, URL, APPROVE)."""
    current = (user_message or '').strip()
    if not current:
        return False
    if _APPROVE_RE.match(current):
        return True
    if re.match(r'^https?://\S+$', current):
        return True
    if _PAGE_REPLY_RE.search(current):
        return True
    if len(current) < 240:
        return True
    return False
