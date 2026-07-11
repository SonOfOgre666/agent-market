"""Google field extraction is LLM-first on every collection turn."""

from __future__ import annotations

from unittest.mock import patch

from lib.planner.google_campaign_llm import GoogleCampaignFieldExtraction
from lib.planner.google_campaign_spec import compile_google_campaign


@patch('lib.planner.google_campaign_spec.generate_rsa_copy_with_llm')
@patch('lib.planner.google_campaign_spec.run_search_keyword_pipeline')
@patch(
    'lib.planner.google_campaign_spec.extract_google_campaign_fields_with_llm',
    return_value=GoogleCampaignFieldExtraction(
        campaign_type='search',
        daily_budget=8.0,
        geo_countries=['MA'],
    ),
)
def test_collect_turn_always_calls_field_llm(_fields, mock_pipeline, mock_rsa):
    history = [
        {'role': 'user', 'content': 'Create google advertising setup for fitness supplements targeting Morocco.'},
        {'role': 'assistant', 'content': 'What campaign type do you want?'},
    ]
    prompt = 'Search\n\n8$\n\nend after 2 days'
    ctx = {'attached_media': [], 'conversation_history': history}

    compile_google_campaign(
        name='Test',
        prompt=prompt,
        ctx=ctx,
        base_payload={'account_id': 'acc1', 'workspace_id': 'ws1'},
    )
    _fields.assert_called_once()
    mock_pipeline.assert_not_called()
    mock_rsa.assert_not_called()


@patch('lib.planner.google_campaign_spec.extract_google_campaign_fields_with_llm')
def test_llm_typo_searh_maps_to_search(mock_extract):
    mock_extract.return_value = GoogleCampaignFieldExtraction(
        campaign_type='search',
        daily_budget=7.0,
        end_time='2026-06-16T23:59:59+0000',
        business_context='fitness supplements',
    )
    _compiled, missing, *_ = compile_google_campaign(
        name='Test',
        prompt='Searh campaign\n7$\nend until tomorrow',
        ctx={'conversation_history': [], 'attached_media': []},
        base_payload={'account_id': 'a1', 'workspace_id': 'w1'},
    )
    assert any('Landing page URL' in line for line in missing)
