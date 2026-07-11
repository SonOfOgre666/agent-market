"""Plain chat + collection phases — when the workflow card should stay hidden."""

from __future__ import annotations

from typing import Any


def is_chat_only_graph(graph: dict[str, Any] | None) -> bool:
    """True when the planner produced a conversational answer only (no tools to run)."""
    if not isinstance(graph, dict):
        return False
    if graph.get('chat_only'):
        return True
    steps = graph.get('steps') or []
    intent = str(graph.get('intent') or '').strip()
    if intent != 'informational':
        return False
    if steps:
        return False
    if graph.get('requires_approval'):
        return False
    if graph.get('google_setup_phase') or graph.get('meta_setup_phase'):
        return False
    if graph.get('google_compiled') or graph.get('meta_compiled'):
        return False
    if graph.get('collection_phase'):
        return False
    if graph.get('execute_plan'):
        return False
    return True


def is_collection_phase_graph(graph: dict[str, Any] | None, *, summary: str = '') -> bool:
    """Collecting missing campaign fields — assistant text only, no workflow card."""
    if not isinstance(graph, dict):
        return False
    if graph.get('collection_phase'):
        return True
    steps = graph.get('steps') or []
    if steps:
        return False
    phase = graph.get('google_setup_phase') or graph.get('meta_setup_phase')
    if phase in ('discovery',):
        return True
    text = (summary or graph.get('summary') or '').lower()
    if 'collect campaign details' in text or 'collect google campaign details' in text:
        return True
    if graph.get('execute_plan') and not graph.get('requires_approval'):
        return phase != 'ready_for_review'
    return False


def should_show_workflow_card(
    graph: dict[str, Any] | None,
    *,
    status: str = '',
    summary: str = '',
) -> bool:
    """Show Approve/Reject or execution card only when ready — not during collection or chat."""
    if not isinstance(graph, dict):
        return False
    if is_chat_only_graph(graph):
        return False
    if is_collection_phase_graph(graph, summary=summary):
        return False

    steps = graph.get('steps') or []
    st = (status or '').strip().lower()

    if graph.get('requires_approval') and st == 'awaiting_approval':
        return True
    if graph.get('google_setup_phase') == 'ready_for_review' or graph.get('meta_setup_phase') == 'ready_for_review':
        return True

    if steps and st in ('running', 'queued', 'approved', 'planned', 'completed', 'failed'):
        return True

    return False
