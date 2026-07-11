"""Tests for ads marketing content API helpers."""

from __future__ import annotations

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
def test_suggest_keywords_fallback_not_french_templates(_llm):
    out = suggest_keywords_for_topic(
        topic='legal contract review software',
        country='US',
        language='en',
    )
    assert out['ok'] is True
    assert out['source'] == 'fallback'
    kws = [s['keyword'] for s in out['suggestions']]
    assert 'prix' not in ' '.join(kws).lower()
    assert 'meilleur' not in ' '.join(kws).lower()
    assert any('legal' in k.lower() or 'software' in k.lower() for k in kws)


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
