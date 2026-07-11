"""Tests for ads marketing intelligence registry tools."""

from __future__ import annotations

from unittest.mock import patch

from tools.ads.marketing_intelligence import (
    run_google_generate_search_keywords,
    run_meta_generate_ad_copy,
)


@patch('tools.ads.marketing_intelligence.run_search_keyword_pipeline')
def test_google_generate_search_keywords_tool(mock_pipeline):
    mock_pipeline.return_value = type(
        'R',
        (),
        {
            'keywords': ['buy whey protein'],
            'suggested_keywords': ['creatine morocco'],
            'keyword_seeds': ['whey protein'],
            'source': 'llm',
        },
    )()
    out = run_google_generate_search_keywords({
        'prompt': 'fitness supplements Morocco',
        'workspace_id': 'ws1',
    })
    assert out['ok'] is True
    assert out['keywords'] == ['buy whey protein']
    assert out['source'] == 'llm'


@patch('tools.ads.marketing_intelligence.resolve_meta_ad_copy')
def test_meta_generate_ad_copy_tool(mock_copy):
    mock_copy.return_value = ('Shop now', 'Fitness Store', 'Quality products', 'llm')
    out = run_meta_generate_ad_copy({
        'prompt': 'fitness supplement store',
        'campaign_name': 'Fitness Store',
        'objective': 'OUTCOME_TRAFFIC',
        'workspace_id': 'ws1',
    })
    assert out['ok'] is True
    assert out['message'] == 'Shop now'
    assert out['source'] == 'llm'
