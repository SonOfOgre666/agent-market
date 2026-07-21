"""Meta ads multi-turn collection — merge follow-ups into planning context."""

from __future__ import annotations

from unittest.mock import patch

from lib.planner.ads_helpers import (
    is_ads_clarification_followup,
    is_meta_campaign_collection_active,
    resolve_ads_planning_message,
)
from lib.planner.meta_campaign_spec import extract_daily_budget, plan_meta_create_workflow
from lib.planner.meta_page_selection import build_meta_setup_clarification_message


def _llm_clarification_assistant_message() -> str:
    return (
        'Got it — Page **Éstee Lauder Việt Nam 19005**, **$7/day**, '
        'starts **2026-06-15**, ends **2026-06-22**, targeting **MA**.\n\n'
        "Thanks — I've noted the Facebook Page. "
        'Please provide the missing campaign objective: Traffic, Awareness, Engagement, Leads, Sales, or App Promotion?'
    )


def _clarification_assistant_message() -> str:
    return build_meta_setup_clarification_message(
        missing_lines=[
            '**Campaign objective** — Traffic, Awareness, Engagement, Leads, Sales, or App Promotion?',
            '**Daily budget** — e.g. $25/day (minimum $1; never defaulted)',
            '**End date** — when should this campaign stop?',
        ],
        pages=[
            {'id': '1017242748148368', 'name': 'Jszsn'},
            {'id': '122097662936017577', 'name': 'Éstee Lauder Việt Nam 19005'},
        ],
    )


def test_llm_clarification_keeps_collection_active():
    anchor = 'Create a Meta advertising setup for fitness supplements targeting Morocco.'
    history = [
        {'role': 'user', 'content': anchor},
        {'role': 'assistant', 'content': _clarification_assistant_message()},
        {'role': 'user', 'content': 'page 1\n7$\nstart tomorow and it end to next week'},
        {'role': 'assistant', 'content': _llm_clarification_assistant_message()},
    ]
    assert is_meta_campaign_collection_active(history) is True
    assert is_ads_clarification_followup('Traffic', history) is True
    assert is_ads_clarification_followup(
        'Traffic\nhttps://shop.example.com',
        history,
    ) is True


@patch('lib.planner.meta_campaign_spec.fetch_usable_pages')
def test_traffic_and_url_after_llm_clarification(mock_pages):
    mock_pages.return_value = [
        {'id': '122097662936017577', 'name': 'Éstee Lauder Việt Nam 19005'},
        {'id': '1017242748148368', 'name': 'Jszsn'},
    ]
    anchor = 'Create a Meta advertising setup for fitness supplements targeting Morocco.'
    history = [
        {'role': 'user', 'content': anchor},
        {'role': 'assistant', 'content': _clarification_assistant_message()},
        {'role': 'user', 'content': 'page 1\n7$\nstart tomorow and it end to next week'},
        {'role': 'assistant', 'content': _llm_clarification_assistant_message()},
    ]
    current = 'Traffic\nhttps://scripting-coral-alpine-age.trycloudflare.com/agent'
    merged = resolve_ads_planning_message(current, history)
    assert anchor in merged
    assert 'Traffic' in merged
    assert 'trycloudflare.com' in merged
    graph = plan_meta_create_workflow(
        prompt=merged,
        ctx={
            'attached_media': [],
            'conversation_history': history + [{'role': 'user', 'content': current}],
            'workspace_id': None,
        },
        base_payload={'account_id': 'acc1'},
        name='Fitness Supplements',
    )
    assert graph['intent'] == 'informational'
    assert 'could not plan workflow' not in graph.get('assistant_message', '').lower()
    msg = graph['assistant_message']
    assert 'Campaign objective' not in msg or 'missing campaign objective' not in msg.lower()
    assert 'Daily budget' not in msg
    assert 'End date' not in msg


def test_clarification_followup_detects_cbo_prompt():
    history = [
        {
            'role': 'user',
            'content': 'Create a Meta advertising setup for fitness supplements targeting Morocco.',
        },
        {'role': 'assistant', 'content': _clarification_assistant_message()},
    ]
    assert is_ads_clarification_followup('Jszsn', history) is True
    assert is_ads_clarification_followup('Traffic', history) is True
    assert is_ads_clarification_followup('2$', history) is True


def test_resolve_planning_message_accumulates_follow_ups():
    anchor = 'Create a Meta advertising setup for fitness supplements targeting Morocco.'
    history = [
        {'role': 'user', 'content': anchor},
        {'role': 'assistant', 'content': _clarification_assistant_message()},
        {'role': 'user', 'content': 'Jszsn'},
        {'role': 'assistant', 'content': _clarification_assistant_message()},
        {'role': 'user', 'content': 'Traffic'},
        {'role': 'assistant', 'content': _clarification_assistant_message()},
    ]
    merged = resolve_ads_planning_message('2$', history)
    assert anchor in merged
    assert 'Jszsn' in merged
    assert 'Traffic' in merged
    assert '2$' in merged


def test_extract_daily_budget_parses_dollar_suffix():
    assert extract_daily_budget('2$') == 2.0
    assert extract_daily_budget('budget reply\n\n2$') == 2.0


@patch('lib.planner.meta_campaign_spec.fetch_usable_pages')
def test_plan_after_multi_turn_followups(mock_pages):
    mock_pages.return_value = [
        {'id': '1017242748148368', 'name': 'Jszsn'},
        {'id': '122097662936017577', 'name': 'Éstee Lauder Việt Nam 19005'},
    ]
    anchor = 'Create a Meta advertising setup for fitness supplements targeting Morocco.'
    history = [
        {'role': 'user', 'content': anchor},
        {'role': 'assistant', 'content': _clarification_assistant_message()},
        {'role': 'user', 'content': 'Jszsn'},
        {'role': 'assistant', 'content': _clarification_assistant_message()},
        {'role': 'user', 'content': 'Traffic'},
        {'role': 'assistant', 'content': _clarification_assistant_message()},
    ]
    merged = resolve_ads_planning_message('tomorrow\n4$', history)
    ctx = {
        'attached_media': [],
        'conversation_history': history + [{'role': 'user', 'content': 'tomorrow\n4$'}],
        'workspace_id': None,
    }
    graph = plan_meta_create_workflow(
        prompt=merged,
        ctx=ctx,
        base_payload={'account_id': 'acc1'},
        name='Fitness Supplements',
    )
    assert graph['intent'] == 'informational'
    assert graph['steps'] == []
    msg = graph['assistant_message']
    assert 'Campaign objective' not in msg
    assert 'Daily budget' not in msg
    assert 'Facebook Page' not in msg or 'which Page should represent' not in msg
    assert 'End date' not in msg
