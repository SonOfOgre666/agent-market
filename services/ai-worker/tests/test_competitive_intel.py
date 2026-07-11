"""Tests for competitive intelligence scraping and analysis tool."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from lib.competitive_intel import fetch_public_page_text, scrape_competitor_pages
from tools.ads.marketing_intelligence import run_competitive_analysis


@patch('lib.competitive_intel.httpx.get')
def test_fetch_public_page_text_strips_html(mock_get):
    mock_resp = MagicMock()
    mock_resp.headers = {'content-type': 'text/html'}
    mock_resp.status_code = 200
    mock_resp.text = '<html><head><title>Acme</title></head><body><p>Hello world</p><script>ignore</script></body></html>'
    mock_resp.raise_for_status = MagicMock()
    mock_get.return_value = mock_resp

    out = fetch_public_page_text('competitor.com')
    assert out['ok'] is True
    assert out['title'] == 'Acme'
    assert 'Hello world' in out['text']
    assert 'ignore' not in out['text']


def test_scrape_competitor_pages_caps_at_three():
    with patch('lib.competitive_intel.fetch_public_page_text') as mock_fetch:
        mock_fetch.side_effect = lambda url: {'url': url, 'ok': True, 'text': 'x'}
        pages = scrape_competitor_pages([f'https://c{i}.com' for i in range(5)])
        assert len(pages) == 3


@patch('lib.planner.ads_llm.complete_ads_json_llm')
@patch('lib.competitive_intel.scrape_competitor_pages')
def test_run_competitive_analysis_tool(mock_scrape, mock_llm):
    mock_scrape.return_value = [{'url': 'https://acme.com', 'ok': True, 'title': 'Acme', 'text': 'We sell widgets'}]
    mock_llm.return_value = {
        'competitor_name': 'Acme',
        'positioning_summary': 'Widget leader',
        'strengths': ['brand'],
        'weaknesses': ['price'],
        'messaging_themes': ['quality'],
        'keyword_opportunities': ['buy widgets'],
        'content_gaps': ['comparison page'],
        'ad_creative_insights': ['discount focus'],
        'recommended_actions': [{'priority': 'high', 'action': 'Launch comparison LP', 'rationale': 'gap'}],
    }
    out = run_competitive_analysis({
        'competitor_name': 'Acme',
        'competitor_urls': ['https://acme.com'],
        'workspace_id': 'ws1',
    })
    assert out['ok'] is True
    assert out['analysis']['positioning_summary'] == 'Widget leader'
    assert out['source'] == 'llm'
