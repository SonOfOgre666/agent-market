from lib.planner.chat_only import (
    is_chat_only_graph,
    is_collection_phase_graph,
    should_show_workflow_card,
)


def test_greeting_is_chat_only():
    graph = {'chat_only': True, 'intent': 'informational', 'steps': []}
    assert is_chat_only_graph(graph)
    assert not should_show_workflow_card(graph)


def test_collection_hides_card():
    graph = {
        'intent': 'informational',
        'collection_phase': True,
        'summary': 'Collect Google campaign details before publish.',
        'steps': [],
        'execute_plan': ['google_publish_search_campaign'],
    }
    assert is_collection_phase_graph(graph)
    assert not is_chat_only_graph(graph)
    assert not should_show_workflow_card(graph, status='planned')


def test_review_shows_card():
    graph = {
        'intent': 'informational',
        'google_setup_phase': 'ready_for_review',
        'google_compiled': {'campaign_type': 'search'},
        'requires_approval': True,
        'steps': [],
        'execute_plan': ['google_publish_search_campaign'],
    }
    assert should_show_workflow_card(graph, status='awaiting_approval')


def test_execution_shows_card():
    graph = {
        'intent': 'ads_campaign',
        'steps': [{'step_id': 's1', 'tool_id': 'google_get_account'}],
    }
    assert should_show_workflow_card(graph, status='running')
