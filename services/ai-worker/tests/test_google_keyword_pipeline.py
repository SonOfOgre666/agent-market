"""Tests for hybrid Google Search keyword pipeline."""

from __future__ import annotations

from unittest.mock import patch

from lib.planner.google_keyword_pipeline import (
    KeywordPipelineResult,
    apply_keyword_edits,
    extract_keywords_from_review_history,
    normalize_keyword,
    run_search_keyword_pipeline,
    validate_keywords,
)


def test_validate_keywords_rejects_broad_terms():
    out = validate_keywords(
        [
            'whey protein morocco',
            'wellness',
            'healthy lifestyle',
            'buy creatine',
        ]
    )
    assert 'whey protein morocco' in out
    assert 'buy creatine' in out
    assert 'wellness' not in out
    assert 'healthy lifestyle' not in out


def test_validate_keywords_dedupes():
    out = validate_keywords(['Buy Whey Protein', 'buy whey protein', 'creatine'])
    assert out == ['Buy Whey Protein', 'creatine']


def test_apply_keyword_edits_add_remove():
    base = ['whey protein', 'creatine morocco']
    edited = apply_keyword_edits(base, 'REMOVE whey protein ADD mass gainer morocco')
    assert 'whey protein' not in [normalize_keyword(k) for k in edited]
    assert any('mass gainer' in k for k in edited)


def test_extract_keywords_from_review_history():
    history = [
        {
            'role': 'assistant',
            'content': (
                'Google Campaign Review\n\n'
                'Generated keywords (fallback):\n'
                '  ✓ whey protein\n'
                '  ✓ creatine morocco\n'
                'Suggested keywords:\n'
                '  ○ protein powder morocco\n'
            ),
        },
    ]
    assert extract_keywords_from_review_history(history) == [
        'whey protein',
        'creatine morocco',
    ]


def test_pipeline_fallback_when_ai_and_planner_unavailable():
    with patch('lib.planner.google_campaign_llm.generate_seed_keywords_with_llm', return_value=None), \
         patch('lib.planner.google_keyword_pipeline._try_google_planner', return_value=None):
        result = run_search_keyword_pipeline(
            prompt='fitness supplement store targeting Morocco',
            conversation_history=[],
            business_context='fitness supplement store',
            geo_countries=['MA'],
            geo_target_constant_ids=[2504],
            final_url='https://shop.example.com',
            base_payload={'account_id': 'acc1'},
        )
    assert isinstance(result, KeywordPipelineResult)
    assert result.source == 'fallback'
    assert 'whey protein' not in result.keywords
    assert any('fitness supplement store' in k.lower() for k in result.keywords)
