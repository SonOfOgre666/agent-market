"""Google ads first-message routing — must not fall through to generic planner."""

from __future__ import annotations

from unittest.mock import patch

from lib.planner.ads_fallback import detect_ads_platform, is_actionable_ads_request
from lib.planner.orchestrator import pin_ads_workflow_intent_for_message, should_route_ads_spec


def test_google_advertising_setup_is_actionable():
    msg = 'Create a google advertising setup for fitness supplements targeting Morocco.'
    assert is_actionable_ads_request(msg) is True
    assert detect_ads_platform(msg, {'ads_accounts': []}) == 'google_ads'


def test_should_route_google_without_orchestrator():
    msg = 'Create a google advertising setup for fitness supplements targeting Morocco.'
    ctx = {'ads_accounts': [{'provider': 'google_ads', 'id': 'g1'}]}
    pinned = pin_ads_workflow_intent_for_message(msg, ctx)
    assert pinned is not None
    assert pinned.workflow_id.startswith('google_')
    assert should_route_ads_spec(
        message=msg,
        ctx=ctx,
        workflow_intent=None,
        conversation_history=[],
        ads_followup=False,
        ads_collecting=False,
    ) is True


@patch('lib.planner.google_campaign_spec.compile_google_campaign')
def test_plan_google_first_message_not_generic_failure(mock_compile):
    from lib.planner.google_campaign_spec import plan_google_create_workflow

    mock_compile.return_value = (
        None,
        ['**Daily budget** — e.g. $25/day'],
        False,
        '',
        {'campaign_type': 'search', 'geo': ['MA']},
    )
    msg = 'Create a google advertising setup for fitness supplements targeting Morocco.'
    graph = plan_google_create_workflow(
        prompt=msg,
        ctx={'attached_media': [], 'conversation_history': [], 'workspace_id': None},
        base_payload={'account_id': 'acc1'},
        name='Fitness Search',
    )
    assert graph['intent'] == 'informational'
    assert 'could not plan workflow' not in graph.get('assistant_message', '').lower()
