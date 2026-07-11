"""Tests for Google ad copy LLM + fallback resolution."""

from __future__ import annotations

from unittest.mock import patch

from lib.planner.google_campaign_llm import resolve_google_ad_copy


def test_resolve_google_ad_copy_uses_fallback_when_llm_unavailable():
    with patch(
        'lib.planner.google_campaign_llm.generate_rsa_copy_with_llm',
        return_value=None,
    ):
        headlines, descriptions, source = resolve_google_ad_copy(
            campaign_name='Marrakech Display',
            prompt='display campaign for marrakech tourism',
            conversation_history=[],
            business_context='Marrakech tourism',
            final_url='https://visitmarrakech.com/en/',
            campaign_type='display',
            geo_countries=['MA'],
            workspace_id='ws-1',
        )
    assert source == 'fallback'
    assert len(headlines) >= 3
    assert len(descriptions) >= 2
