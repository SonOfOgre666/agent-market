"""Ads LLM routing — any configured text provider."""

from __future__ import annotations

from unittest.mock import patch

from lib.planner.ads_llm import complete_ads_json_llm, list_ads_llm_configs


@patch('lib.planner.ads_llm.list_ads_llm_configs')
@patch('lib.llm.text.complete')
def test_tries_openai_when_configured(mock_complete, mock_list):
    mock_list.return_value = [
        {'provider': 'openai', 'model': 'gpt-4o-mini', 'api_model_id': 'gpt-4o-mini', 'feature_id': 'planner'},
    ]
    mock_complete.return_value = '{"fields": {"campaign_name": "Brand Search"}}'

    out = complete_ads_json_llm(
        workspace_id='ws1',
        prompt='return json',
        source='test',
    )
    assert out == {'fields': {'campaign_name': 'Brand Search'}}
    mock_complete.assert_called_once()
    assert mock_complete.call_args[0][0] == 'openai'


@patch('lib.planner.ads_llm.list_ads_llm_configs')
@patch('lib.llm.text.complete')
def test_falls_back_to_second_provider(mock_complete, mock_list):
    mock_list.return_value = [
        {'provider': 'gemini', 'model': 'gemini-2.5-flash', 'api_model_id': 'gemini-2.5-flash', 'feature_id': 'google_search_marketing'},
        {'provider': 'anthropic', 'model': 'claude-sonnet-4', 'api_model_id': 'claude-sonnet-4', 'feature_id': 'planner'},
    ]
    mock_complete.side_effect = [RuntimeError('quota'), '{"ok": true}']

    out = complete_ads_json_llm(workspace_id='ws1', prompt='x', source='test')
    assert out == {'ok': True}
    assert mock_complete.call_count == 2
    assert mock_complete.call_args_list[1][0][0] == 'anthropic'
