"""Facebook Page discovery and user selection for Meta ad setup workflows."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

_PAGE_LINE_RE = re.compile(
    r'^(\d+)\.\s+\*\*(.+?)\*\*\s*(?:\(ID:\s*(\d+)\))?',
    re.MULTILINE,
)


def usable_pages(pages_output: dict[str, Any] | None) -> list[dict[str, str]]:
    """Pages with a name and no access error — safe for create_ad_creative."""
    rows = (pages_output or {}).get('data') or []
    out: list[dict[str, str]] = []
    for row in rows:
        if not isinstance(row, dict) or row.get('error'):
            continue
        name = str(row.get('name') or '').strip()
        page_id = str(row.get('id') or '').strip()
        if name and page_id:
            out.append({'id': page_id, 'name': name})
    return out


def fetch_usable_pages(base_payload: dict[str, Any]) -> list[dict[str, str]]:
    """Sync fetch during planning (same data as meta_get_account_pages step)."""
    try:
        from tools.ads._resolve import enrich_ads_tool_payload
        from tools.ads.registry import run_ads_tool

        payload = enrich_ads_tool_payload('meta_get_account_pages', dict(base_payload))
        if not payload.get('access_token'):
            return []
        out = run_ads_tool('meta_get_account_pages', payload)
        if not out.get('ok'):
            return []
        return usable_pages(out)
    except Exception:
        return []


def is_meta_acceptable_destination_url(url: str) -> bool:
    """Meta link_url must be a public URL Meta can fetch — not localhost or private hosts."""
    try:
        parsed = urlparse((url or '').strip())
        host = (parsed.hostname or '').lower()
        if not host or not parsed.scheme in ('http', 'https'):
            return False
        if host in ('localhost', '127.0.0.1', '0.0.0.0', '::1'):
            return False
        if host.endswith('.local') or host.endswith('.localhost'):
            return False
        if host.startswith('192.168.') or host.startswith('10.') or host.startswith('172.'):
            return False
        return True
    except Exception:
        return False


def format_pages_for_user(pages: list[dict[str, str]]) -> str:
    if not pages:
        return (
            'No accessible Facebook Pages on this ad account (only Pages with a visible name work). '
            'Connect a Page in Meta Business Settings, then try again.'
        )
    lines = ['**Facebook Page** — which Page should represent your business?']
    ordinals = ('first', 'second', 'third', 'fourth', 'fifth')
    for i, page in enumerate(pages, start=1):
        ordinal = ordinals[i - 1] if i <= len(ordinals) else str(i)
        lines.append(
            f'{i}. **{page["name"]}** (ID: {page["id"]}) — reply "{ordinal} page", "page {i}", or "{page["name"]}"'
        )
    if len(pages) > 1:
        lines.append('Reply **both** to use every listed Page (one ad per Page).')
    return '\n'.join(lines)


def pages_from_assistant_message(content: str) -> list[dict[str, str]]:
    """Recover page list from a prior setup clarification assistant message."""
    out: list[dict[str, str]] = []
    for match in _PAGE_LINE_RE.finditer(content or ''):
        _num, name, page_id = match.group(1), match.group(2).strip(), match.group(3)
        if page_id:
            out.append({'id': str(page_id), 'name': name})
    return out


def resolve_page_ids(text: str, pages: list[dict[str, str]]) -> list[str]:
    """Map user reply → one or more page IDs (first / second / name / both / ID)."""
    if not pages:
        return []

    hay = (text or '').lower()
    chosen: list[str] = []

    if re.search(r'\bboth\b|\ball pages?\b|\bevery page\b', hay):
        return [p['id'] for p in pages]

    if re.search(r'\bfirst\b|\b1st\b|\bpage\s*1\b|\b#1\b', hay) and pages:
        chosen.append(pages[0]['id'])
    if re.search(r'\bsecond\b|\b2nd\b|\bpage\s*2\b|\b#2\b', hay) and len(pages) > 1:
        chosen.append(pages[1]['id'])
    if re.search(r'\bthird\b|\b3rd\b|\bpage\s*3\b|\b#3\b', hay) and len(pages) > 2:
        chosen.append(pages[2]['id'])

    for i, page in enumerate(pages, start=1):
        page_id = page['id']
        if page_id and re.search(rf'\b{re.escape(page_id)}\b', hay):
            chosen.append(page_id)
        name = page['name'].lower()
        if name:
            if len(name) >= 4 and name in hay:
                chosen.append(page_id)
            elif len(name) < 4 and re.search(rf'\b{re.escape(name)}\b', hay):
                chosen.append(page_id)
        if re.search(rf'\bpage\s*{i}\b', hay):
            chosen.append(page_id)

    # Dedupe preserving order
    seen: set[str] = set()
    out: list[str] = []
    for pid in chosen:
        if pid not in seen:
            seen.add(pid)
            out.append(pid)
    return out


def resolve_page_ids_for_planning(
    prompt: str,
    *,
    base_payload: dict[str, Any],
    conversation_history: list[dict[str, Any]] | None = None,
) -> list[str]:
    """Resolve selected page IDs from current + merged conversation text."""
    pages = fetch_usable_pages(base_payload)
    if not pages and conversation_history:
        for msg in reversed(conversation_history):
            if msg.get('role') != 'assistant':
                continue
            cached = pages_from_assistant_message(str(msg.get('content') or ''))
            if cached:
                pages = cached
                break

    if not pages:
        return []

    return resolve_page_ids_from_conversation(prompt, pages, conversation_history)


def resolve_page_ids_from_conversation(
    prompt: str,
    pages: list[dict[str, str]],
    conversation_history: list[dict[str, Any]] | None,
) -> list[str]:
    """Resolve Page selection from merged prompt plus all user turns."""
    parts = [prompt or '']
    for msg in conversation_history or []:
        if msg.get('role') == 'user':
            text = str(msg.get('content') or '').strip()
            if text:
                parts.append(text)
    return resolve_page_ids('\n\n'.join(parts), pages)


def build_meta_setup_clarification_message(
    *,
    missing_lines: list[str],
    pages: list[dict[str, str]] | None,
    has_image: bool = False,
    preamble: str = '',
) -> str:
    intro = (
        'Before I create the paused CBO campaign on Meta (campaign → ad set → upload → creative → ad), '
        'please provide:'
    )
    blocks: list[str] = []
    if preamble:
        blocks.append(preamble.strip())
    blocks.append(intro)

    needs_page = any(
        line.startswith('**Facebook Page**') or 'which Page should represent' in line
        for line in missing_lines
    )
    if pages is not None and needs_page:
        blocks.append(format_pages_for_user(pages))

    for line in missing_lines:
        if line.startswith('**Facebook Page**') or 'which Page should represent' in line:
            continue
        blocks.append(f'• {line}')

    reply_parts: list[str] = []
    if not has_image and any('image' in line.lower() or 'video' in line.lower() for line in missing_lines):
        reply_parts.append('attach your product image (or say image vs video)')
    if any('budget' in line.lower() for line in missing_lines):
        reply_parts.append('daily budget')
    if any('end date' in line.lower() for line in missing_lines):
        reply_parts.append('end date')
    if any('country' in line.lower() or 'target' in line.lower() for line in missing_lines):
        reply_parts.append('target country')
    if any('website url' in line.lower() or 'shop url' in line.lower() for line in missing_lines):
        reply_parts.append('a **public HTTPS** shop URL')
    if needs_page:
        reply_parts.append('which Page to use')
    if reply_parts:
        blocks.append(f'You can reply in one message with: {", ".join(reply_parts)}.')
    return '\n\n'.join(blocks)
