"""Normalize post version content for social connectors (no provider I/O)."""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple


def resolve_version(post: dict, account_id: str) -> Optional[dict]:
    versions = post.get('versions') or []
    for v in versions:
        if str(v.get('account_id') or '') == account_id:
            return v
    for v in versions:
        if v.get('is_original'):
            return v
    return None


def extract_text_link_media(version: dict) -> Tuple[str, Optional[str], List[dict]]:
    content = version.get('content') or []
    text = ''
    link_url = None
    media_items: List[dict] = []
    for block in content:
        t = block.get('type')
        if t == 'text':
            text = block.get('body') or ''
        elif t == 'link':
            link_url = block.get('url')
        elif t == 'media':
            for item in block.get('media') or []:
                media_items.append(item)
    return text, link_url, media_items


def account_id_str(account: dict) -> str:
    return str(account.get('_id') or account.get('id') or '')
