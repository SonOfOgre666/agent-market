"""Tests for post-execution result narrator."""

from __future__ import annotations

from lib.planner.result_narrator import (
    apply_result_message,
    compact_step_results,
    should_narrate_result,
)
from lib.planner import result_narrator as rn


def test_compact_step_results_orders_by_graph_and_truncates():
    graph = {
        'steps': [
            {'step_id': 'step_1', 'tool_id': 'meta_list_campaigns'},
            {'step_id': 'step_2', 'tool_id': 'meta_report_insights'},
        ],
    }
    results = {
        'step_2': {'status': 'completed', 'output': {'rows': list(range(100))}},
        'step_1': {'status': 'completed', 'output': {'campaigns': []}},
    }
    compact = compact_step_results(results, graph)
    assert [s['step_id'] for s in compact] == ['step_1', 'step_2']
    assert compact[0]['tool_id'] == 'meta_list_campaigns'
    assert compact[0]['output'] == {'campaigns': []}
    assert isinstance(compact[1]['output']['rows'], list)
    assert len(compact[1]['output']['rows']) == 41  # 40 + overflow marker


def test_should_narrate_skips_discovery_and_non_terminal():
    assert should_narrate_result(status='running', graph={}) is False
    assert should_narrate_result(status='awaiting_approval', graph={}) is False
    assert should_narrate_result(
        status='completed',
        graph={'meta_setup_phase': 'discovery'},
    ) is False
    assert should_narrate_result(status='completed', graph={'intent': 'analytics'}) is True
    assert should_narrate_result(status='failed', graph={}) is True


def test_apply_result_message_sets_graph_fields():
    g = apply_result_message({'intent': 'analytics', 'summary': 'old', 'assistant_message': 'Checking…'}, 'Found 2 campaigns.')
    assert g['result_assistant_message'] == 'Found 2 campaigns.'
    assert g['summary'] == 'old'
    assert g['assistant_message'] == 'Checking…'
    assert g['intent'] == 'analytics'


def test_narrate_uses_llm_when_available(monkeypatch):
    calls = {}

    def fake_planner_config(_wid):
        return {'provider': 'openai', 'model': 'gpt', 'api_model_id': 'gpt'}

    def fake_complete(*_a, **_k):
        calls['ok'] = True
        return '  Your Meta campaigns: Summer Sale is active.  '

    import lib.ai_workspace_config as cfg_mod
    import lib.llm.text as text_mod

    monkeypatch.setattr(cfg_mod, 'get_planner_config', fake_planner_config)
    monkeypatch.setattr(text_mod, 'complete', fake_complete)

    msg = rn.narrate_workflow_result(
        workspace_id='ws1',
        user_message='list my campaigns',
        status='completed',
        graph={'intent': 'analytics', 'summary': 'List Meta campaigns', 'steps': []},
        step_results={
            'step_1': {
                'status': 'completed',
                'tool_id': 'meta_list_campaigns',
                'output': {'campaigns': [{'name': 'Summer Sale'}]},
            },
        },
        errors=[],
    )
    assert calls.get('ok') is True
    assert msg == 'Your Meta campaigns: Summer Sale is active.'


def test_narrate_fallback_on_llm_error(monkeypatch):
    import lib.ai_workspace_config as cfg_mod

    def boom(_wid):
        raise RuntimeError('no planner config')

    monkeypatch.setattr(cfg_mod, 'get_planner_config', boom)

    msg = rn.narrate_workflow_result(
        workspace_id='ws1',
        user_message='create campaign',
        status='failed',
        graph={'intent': 'ads_campaign', 'steps': []},
        step_results={
            'step_1': {'status': 'failed', 'error': 'Invalid access token'},
        },
        errors=['Invalid access token'],
    )
    assert 'Invalid access token' in msg


def test_narrate_fallback_prefers_success_over_twin_failure(monkeypatch):
    import lib.ai_workspace_config as cfg_mod

    def boom(_wid):
        raise RuntimeError('no planner config')

    monkeypatch.setattr(cfg_mod, 'get_planner_config', boom)

    msg = rn.narrate_workflow_result(
        workspace_id='ws1',
        user_message='do I have campaigns',
        status='completed',
        graph={'intent': 'analytics', 'steps': []},
        step_results={
            'step_1': {'status': 'failed', 'tool_id': 'meta_list_campaigns', 'error': 'Cannot call API'},
            'step_2': {
                'status': 'completed',
                'tool_id': 'meta_list_campaigns',
                'output': {'data': [{'name': 'test1'}]},
            },
        },
        errors=['step_1: Cannot call API'],
    )
    assert 'usable results' in msg.lower() or 'meta list' in msg.lower()
    assert 'Cannot call API' not in msg
