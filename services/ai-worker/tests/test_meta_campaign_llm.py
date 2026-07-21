"""Planner LLM extraction for Meta campaign collection."""

from __future__ import annotations

import json
from unittest.mock import patch

from lib.planner.meta_campaign_llm import extract_with_planner_llm
from lib.planner.meta_campaign_spec import extract_end_time_iso, plan_meta_create_workflow
from lib.planner.ads_helpers import resolve_ads_planning_message


def test_tomorrow_parsed_as_end_date():
    end = extract_end_time_iso('run until tomorrow')
    assert end is not None
    assert 'T23:59:59' in end


def test_start_tomorrow_end_next_week():
    from lib.planner.meta_campaign_spec import extract_schedule_times

    start, end = extract_schedule_times('it start tomorow and end on next week')
    assert start is not None
    assert end is not None
    assert 'T00:00:00' in start
    assert 'T23:59:59' in end
    assert end[:10] > start[:10]


@patch('lib.ai_execution_log.record_execution')
@patch('lib.llm.text.is_text_provider_configured', return_value=True)
@patch('lib.llm.text.complete')
@patch('lib.ai_workspace_config.get_planner_config')
def test_llm_extracts_page_objective_budget_end(mock_cfg, mock_llm, _mock_configured, _mock_record):
    mock_cfg.return_value = {
        'provider': 'openai',
        'model': 'gpt-4',
        'api_model_id': 'gpt-4',
    }
    mock_llm.return_value = json.dumps({
        'understood_summary': 'Using Jszsn, Traffic, $4/day, ending tomorrow, Morocco.',
        'fields': {
            'objective': 'OUTCOME_TRAFFIC',
            'page_ids': ['1017242748148368'],
            'daily_budget': 4,
            'end_date': '2026-06-13',
            'geo_countries': ['MA'],
            'link_url': None,
            'creative_format': None,
        },
    })
    pages = [
        {'id': '122097662936017577', 'name': 'Éstee Lauder Việt Nam 19005'},
        {'id': '1017242748148368', 'name': 'Jszsn'},
    ]
    result = extract_with_planner_llm(
        prompt='Jszsn\nTraffic\ntomorrow\n4$',
        conversation_history=[
            {
                'role': 'user',
                'content': 'Create Meta advertising setup for fitness supplements targeting Morocco.',
            },
        ],
        pages=pages,
        workspace_id='ws1',
    )
    assert result is not None
    assert result.objective == 'OUTCOME_TRAFFIC'
    assert result.page_ids == ['1017242748148368']
    assert result.daily_budget == 4.0
    assert result.end_time is not None


@patch('lib.llm.text.is_text_provider_configured', return_value=True)
@patch('lib.planner.meta_campaign_llm.build_clarification_with_planner_llm')
@patch('lib.planner.meta_campaign_llm.extract_with_planner_llm')
def test_user_scenario_without_reasking_page(mock_extract, mock_clarify, _mock_configured):
    from unittest.mock import patch

    pages = [
        {'id': '122097662936017577', 'name': 'Éstee Lauder Việt Nam 19005'},
        {'id': '1017242748148368', 'name': 'Jszsn'},
    ]
    with patch('lib.planner.meta_campaign_spec.fetch_usable_pages', return_value=pages):
        mock_clarify.return_value = (
            'Got it — Jszsn page, Traffic, $4/day until tomorrow, Morocco.\n\n'
            'Still need: image or video, and a public HTTPS shop URL.'
        )

        from lib.planner.meta_campaign_llm import PlannerCampaignExtraction

        mock_extract.return_value = PlannerCampaignExtraction(
            objective='OUTCOME_TRAFFIC',
            page_ids=['1017242748148368'],
            daily_budget=4.0,
            end_time='2026-06-13T23:59:59+0000',
            geo_countries=['MA'],
            understood_summary='Got it — Jszsn page, Traffic, $4/day until tomorrow, Morocco.',
        )

        anchor = 'Create a Meta advertising setup for fitness supplements targeting Morocco.'
        history = [
            {'role': 'user', 'content': anchor},
            {'role': 'assistant', 'content': 'please provide:'},
        ]
        merged = resolve_ads_planning_message('Jszsn\nTraffic\ntomorrow\n4$', history)
        graph = plan_meta_create_workflow(
            prompt=merged,
            ctx={
                'attached_media': [],
                'conversation_history': history + [{'role': 'user', 'content': 'Jszsn\nTraffic\ntomorrow\n4$'}],
                'workspace_id': 'ws1',
            },
            base_payload={'account_id': 'acc1', 'workspace_id': 'ws1'},
            name='Fitness Supplements',
        )
        msg = graph['assistant_message']
        assert 'which Page should represent' not in msg
        assert 'Campaign objective' not in msg
        assert 'Daily budget' not in msg
        assert 'End date' not in msg or 'Still need' in msg


def test_emergency_meta_copy_is_not_vertical():
    from lib.planner.meta_campaign_llm import emergency_meta_ad_copy

    message, headline, description = emergency_meta_ad_copy('Fitness Store', 'OUTCOME_TRAFFIC')
    assert 'Fuel your fitness' not in message
    assert 'Fitness Store' in headline or 'Fitness Store' in message


def test_strategy_query_fallback_uses_business_not_fitness_default():
    from lib.planner.meta_campaign_llm import _fallback_strategy_queries

    geo_q, interest_q = _fallback_strategy_queries(
        'Create Meta ads for my legal contract review software targeting Morocco',
        ['MA'],
    )
    assert geo_q == 'Morocco'
    assert 'fitness' not in interest_q.lower()
    assert 'legal' in interest_q.lower() or 'contract' in interest_q.lower() or 'software' in interest_q.lower()

