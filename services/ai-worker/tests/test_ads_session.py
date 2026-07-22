"""Ads multi-turn session — model-written collection prompts."""

from __future__ import annotations

from unittest.mock import patch

from lib.planner.ads_session import (
    is_ads_collection_active,
    is_assistant_collecting_ads_fields,
    merge_ads_conversation_user_messages,
    resolve_ads_session,
)
from lib.planner.ads_helpers import is_ads_clarification_followup, resolve_ads_planning_message


def _model_written_page_prompt() -> str:
    return (
        'I understand you want to create a Meta Ads campaign for fitness supplements targeting Morocco.\n\n'
        'Which Facebook Page should represent your business? You can choose:\n\n'
        '1. Jszsn — reply "first page", "page 1", or "Jszsn"\n'
        '2. Éstee Lauder Việt Nam 19005 — reply "second page", "page 2", or "Éstee Lauder Việt Nam 19005"\n\n'
        'Reply "both" if you want to use every listed Page, with one ad per Page.'
    )


def test_model_written_collection_prompt_detected():
    msg = _model_written_page_prompt()
    assert is_assistant_collecting_ads_fields(msg) is True
    assert is_ads_collection_active([
        {'role': 'user', 'content': 'Create a Meta advertising setup for fitness supplements targeting Morocco.'},
        {'role': 'assistant', 'content': msg},
    ]) is True


def test_first_page_followup_merges_anchor():
    anchor = 'Create a Meta advertising setup for fitness supplements targeting Morocco.'
    history = [
        {'role': 'user', 'content': anchor},
        {'role': 'assistant', 'content': _model_written_page_prompt()},
    ]
    assert is_ads_clarification_followup('first page', history) is True
    merged = resolve_ads_planning_message('first page', history)
    assert anchor in merged
    assert 'first page' in merged


@patch('lib.planner.meta_campaign_spec.fetch_usable_pages')
def test_plan_after_first_page_followup(mock_pages):
    from lib.planner.meta_campaign_spec import plan_meta_create_workflow

    mock_pages.return_value = [
        {'id': '1017242748148368', 'name': 'Jszsn'},
        {'id': '122097662936017577', 'name': 'Éstee Lauder Việt Nam 19005'},
    ]
    anchor = 'Create a Meta advertising setup for fitness supplements targeting Morocco.'
    history = [
        {'role': 'user', 'content': anchor},
        {'role': 'assistant', 'content': _model_written_page_prompt()},
    ]
    merged = resolve_ads_planning_message('first page', history)
    graph = plan_meta_create_workflow(
        prompt=merged,
        ctx={
            'attached_media': [],
            'conversation_history': history + [{'role': 'user', 'content': 'first page'}],
            'workspace_id': None,
        },
        base_payload={'account_id': 'acc1'},
        name='Fitness Supplements',
    )
    assert graph['intent'] == 'informational'
    assert 'could not plan workflow' not in graph.get('assistant_message', '').lower()
    assert graph['steps'] == []


def test_resolve_session_pins_meta_platform():
    session = resolve_ads_session([
        {'role': 'user', 'content': 'Create Meta ads for Morocco'},
        {'role': 'assistant', 'content': _model_written_page_prompt()},
    ])
    assert session.active is True
    assert session.platform == 'meta_ads'
    assert session.pinned_intent is not None
    assert session.pinned_intent.workflow_id.startswith('meta_')


def test_collection_active_from_graph_metadata():
    """Graph collection_phase wins without scanning assistant phrase lists."""
    history = [
        {'role': 'user', 'content': 'Create Meta ads'},
        {
            'role': 'assistant',
            'content': 'What is your daily budget?',
            'workflow_id': 'wf_graph_1',
        },
    ]
    with patch('lib.planner.ads_session.load_workflow_graph', return_value={'collection_phase': True, 'intent': 'informational'}):
        assert is_ads_collection_active(history) is True
        assert is_ads_clarification_followup('$25/day', history) is True
        merged = resolve_ads_planning_message('$25/day', history)
        assert 'Create Meta ads' in merged
        assert '$25/day' in merged


def test_graph_ready_for_review_stops_collection():
    history = [
        {'role': 'user', 'content': 'Create Meta ads'},
        {
            'role': 'assistant',
            'content': 'Review and type APPROVE',
            'workflow_id': 'wf_review',
        },
    ]
    with patch(
        'lib.planner.ads_session.load_workflow_graph',
        return_value={'meta_setup_phase': 'ready_for_review', 'steps': []},
    ):
        assert is_ads_collection_active(history) is False


def test_merge_dedupes_user_turns():
    anchor = 'Create Meta ads Morocco'
    history = [
        {'role': 'user', 'content': anchor},
        {'role': 'assistant', 'content': _model_written_page_prompt()},
        {'role': 'user', 'content': 'first page'},
        {'role': 'assistant', 'content': 'Need objective and daily budget for your Meta campaign.'},
    ]
    merged = merge_ads_conversation_user_messages('Leads', history)
    assert anchor in merged
    assert 'first page' in merged
    assert 'Leads' in merged
