"""Tests for ads marketing content API helpers."""

from __future__ import annotations

import pytest
from unittest.mock import patch

from lib.ads_marketing_content import (
    generate_campaign_search_assets,
    generate_landing_page_marketing_content,
    suggest_keywords_for_topic,
)


def test_suggest_keywords_requires_topic():
    out = suggest_keywords_for_topic(topic='')
    assert out.get('ok') is False


@patch('lib.planner.google_campaign_llm.generate_seed_keywords_with_llm', return_value=None)
def test_suggest_keywords_requires_llm_when_unconfigured(_llm):
    with pytest.raises(RuntimeError, match='Google Ads Marketing AI'):
        suggest_keywords_for_topic(
            topic='legal contract review software',
            country='US',
            language='en',
        )


@patch('lib.planner.google_campaign_llm.generate_rsa_copy_with_llm', return_value=None)
def test_campaign_assets_use_emergency_not_french(_rsa):
    out = generate_campaign_search_assets(
        campaign_name='Fitness Store',
        keywords=['protein'],
        workspace_id=None,
    )
    assert out['source'] == 'fallback'
    joined = ' '.join(out['headlines'] + out['descriptions']).lower()
    assert 'découvrez' not in joined
    assert 'offre exclusive' not in joined


@patch('lib.ads_marketing_content.generate_landing_page_marketing_content')
def test_landing_page_llm_path(mock_gen):
    mock_gen.return_value = {
        'headline': 'AI Contract Review',
        'subheadline': 'Faster deals',
        'body': 'Review contracts in minutes.',
        'cta_text': 'Start free trial',
        'source': 'llm',
    }
    out = mock_gen(campaign_name='Legal AI', workspace_id='ws1')
    assert out['source'] == 'llm'
    assert 'Contract' in out['headline']
