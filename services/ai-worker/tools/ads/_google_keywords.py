"""Shared keyword payload normalization for Google Ads tools."""

from __future__ import annotations

from typing import Any, Dict, List

from connectors.google_ads.keywords import normalize_keyword_entries


def parse_keyword_payload(payload: Dict[str, Any]) -> List[Dict[str, str]]:
    """Accept keyword_entries, keywords as dicts, or legacy string list + match_type."""
    entries = payload.get('keyword_entries')
    if isinstance(entries, list) and entries:
        return normalize_keyword_entries(entries, default_match_type=str(payload.get('match_type') or 'BROAD'))

    raw = payload.get('keywords')
    if isinstance(raw, list) and raw and isinstance(raw[0], dict):
        return normalize_keyword_entries(raw, default_match_type=str(payload.get('match_type') or 'BROAD'))

    if isinstance(raw, str):
        lines = [k.strip() for k in raw.replace(',', '\n').split('\n') if k.strip()]
        return normalize_keyword_entries(lines, default_match_type=str(payload.get('match_type') or 'BROAD'))

    return normalize_keyword_entries(
        list(raw or []) if isinstance(raw, list) else [],
        default_match_type=str(payload.get('match_type') or 'BROAD'),
    )
