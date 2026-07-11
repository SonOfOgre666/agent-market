"""Public-page scraping + Meta Ads Library compaction for competitive analysis."""

from __future__ import annotations

import re
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urlparse

import httpx

_MAX_URLS = 3
_MAX_PAGE_CHARS = 8000
_FETCH_TIMEOUT = 20.0
_USER_AGENT = 'AgentMarket-CompetitiveBot/1.0 (+https://github.com/agent-market)'


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._chunks: list[str] = []
        self._title: str | None = None
        self._in_title = False
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        t = tag.lower()
        if t in ('script', 'style', 'noscript'):
            self._skip_depth += 1
        if t == 'title':
            self._in_title = True

    def handle_endtag(self, tag: str) -> None:
        t = tag.lower()
        if t in ('script', 'style', 'noscript') and self._skip_depth:
            self._skip_depth -= 1
        if t == 'title':
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        text = re.sub(r'\s+', ' ', (data or '').strip())
        if not text:
            return
        if self._in_title:
            self._title = (self._title or '') + text
        else:
            self._chunks.append(text)

    @property
    def title(self) -> str | None:
        return self._title.strip() if self._title else None

    def body_text(self) -> str:
        return ' '.join(self._chunks)


def _normalize_url(url: str) -> str:
    raw = (url or '').strip()
    if not raw:
        raise ValueError('empty url')
    if not raw.startswith(('http://', 'https://')):
        raw = f'https://{raw}'
    parsed = urlparse(raw)
    if parsed.scheme not in ('http', 'https') or not parsed.netloc:
        raise ValueError(f'invalid url: {url}')
    return raw


def fetch_public_page_text(url: str) -> dict[str, Any]:
    """Fetch a public page and return title + plain text (no JS rendering)."""
    normalized = _normalize_url(url)
    try:
        resp = httpx.get(
            normalized,
            timeout=_FETCH_TIMEOUT,
            follow_redirects=True,
            headers={'User-Agent': _USER_AGENT, 'Accept': 'text/html,application/xhtml+xml'},
        )
        resp.raise_for_status()
        content_type = (resp.headers.get('content-type') or '').lower()
        if 'html' not in content_type and 'text' not in content_type:
            return {
                'url': normalized,
                'ok': False,
                'error': f'unsupported content-type: {content_type or "unknown"}',
            }
        html = resp.text or ''
        parser = _TextExtractor()
        parser.feed(html[:500_000])
        text = parser.body_text()
        if len(text) > _MAX_PAGE_CHARS:
            text = text[:_MAX_PAGE_CHARS] + '…'
        return {
            'url': normalized,
            'ok': True,
            'title': parser.title,
            'text': text,
            'char_count': len(text),
            'status_code': resp.status_code,
        }
    except Exception as exc:
        return {'url': normalized, 'ok': False, 'error': str(exc)}


def scrape_competitor_pages(urls: list[str] | None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for raw in (urls or [])[:_MAX_URLS]:
        u = str(raw or '').strip()
        if not u:
            continue
        out.append(fetch_public_page_text(u))
    return out


def compact_ads_library_rows(rows: list[dict[str, Any]] | None, *, limit: int = 15) -> list[dict[str, Any]]:
    """Trim Meta Ads Library rows for LLM context."""
    compact = []
    for row in (rows or [])[:limit]:
        if not isinstance(row, dict):
            continue
        compact.append({
            'page_name': row.get('page_name'),
            'ad_creative_body': (row.get('ad_creative_body') or '')[:400],
            'ad_creative_link_title': row.get('ad_creative_link_title'),
            'ad_creative_link_description': (row.get('ad_creative_link_description') or '')[:200],
            'publisher_platform': row.get('publisher_platform'),
            'impressions': row.get('impressions'),
            'spend': row.get('spend'),
            'ad_delivery_start_time': row.get('ad_delivery_start_time'),
        })
    return compact
