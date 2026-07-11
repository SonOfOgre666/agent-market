"""Lightweight SERP position checks (DuckDuckGo HTML) — no paid API required."""

from __future__ import annotations

import re
import time
from html.parser import HTMLParser
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

import httpx

_USER_AGENT = 'AgentMarket-SeoBot/1.0'
_DDG_HTML = 'https://html.duckduckgo.com/html/'
_MAX_RESULTS = 30
_REQUEST_DELAY_S = 0.6


class _DdgResultParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []
        self._in_result_link = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != 'a':
            return
        attr = dict(attrs)
        cls = attr.get('class') or ''
        if 'result__a' in cls.split():
            href = attr.get('href') or ''
            if href:
                self.links.append(href)
                self._in_result_link = True

    def handle_endtag(self, tag: str) -> None:
        if tag == 'a' and self._in_result_link:
            self._in_result_link = False


def _normalize_domain(domain: str) -> str:
    d = str(domain or '').strip().lower()
    d = re.sub(r'^https?://', '', d)
    d = d.split('/')[0]
    if d.startswith('www.'):
        d = d[4:]
    return d


def _resolve_href(href: str) -> str:
    if href.startswith('//'):
        href = f'https:{href}'
    if 'duckduckgo.com/l/?' in href and 'uddg=' in href:
        qs = parse_qs(urlparse(href).query)
        uddg = qs.get('uddg', [''])[0]
        if uddg:
            return unquote(uddg)
    return href


def _domain_from_url(url: str) -> str:
    try:
        return _normalize_domain(urlparse(url).netloc)
    except Exception:
        return ''


def check_keyword_rank(keyword: str, target_domain: str, *, max_results: int = _MAX_RESULTS) -> dict[str, Any]:
    """Return SERP position (1-based) for target_domain, or null if not found."""
    kw = str(keyword or '').strip()
    domain = _normalize_domain(target_domain)
    if not kw or not domain:
        return {
            'keyword': kw,
            'target_domain': domain,
            'position': None,
            'found_url': None,
            'engine': 'duckduckgo_html',
            'error': 'keyword and target_domain required',
        }

    try:
        with httpx.Client(timeout=25.0, follow_redirects=True) as client:
            res = client.post(
                _DDG_HTML,
                data={'q': kw, 'kl': 'us-en'},
                headers={
                    'User-Agent': _USER_AGENT,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            )
            res.raise_for_status()
    except Exception as exc:
        return {
            'keyword': kw,
            'target_domain': domain,
            'position': None,
            'found_url': None,
            'engine': 'duckduckgo_html',
            'error': str(exc),
        }

    parser = _DdgResultParser()
    parser.feed(res.text)

    position = None
    found_url = None
    for idx, raw_href in enumerate(parser.links[:max_results], start=1):
        url = _resolve_href(raw_href)
        link_domain = _domain_from_url(url)
        if not link_domain:
            continue
        if link_domain == domain or link_domain.endswith(f'.{domain}') or domain.endswith(f'.{link_domain}'):
            position = idx
            found_url = url
            break

    return {
        'keyword': kw,
        'target_domain': domain,
        'position': position,
        'found_url': found_url,
        'engine': 'duckduckgo_html',
        'checked_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    }


def check_keyword_batch(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for i, item in enumerate(items or []):
        if i > 0:
            time.sleep(_REQUEST_DELAY_S)
        row = check_keyword_rank(
            str(item.get('keyword') or ''),
            str(item.get('target_domain') or ''),
        )
        if item.get('id'):
            row['id'] = item['id']
        results.append(row)
    return results
