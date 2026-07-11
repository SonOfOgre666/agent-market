"""Pick best geo search result for a location spec (shared Google + Meta)."""

from __future__ import annotations

import re
from typing import Any

from lib.planner.geo_targeting_intent import GeoLocationSpec

_GOOGLE_TYPE_HINTS: dict[str, tuple[str, ...]] = {
    'country': ('country',),
    'state': ('state', 'province', 'region', 'autonomous community'),
    'region': ('region', 'province', 'state', 'department', 'prefecture'),
    'city': ('city', 'municipality', 'borough', 'town'),
    'metro': ('dma region', 'metro', 'market'),
    'zip': ('postal code', 'zip'),
}

_META_TYPE_HINTS: dict[str, tuple[str, ...]] = {
    'country': ('country',),
    'state': ('region', 'state'),
    'region': ('region',),
    'city': ('city',),
    'metro': ('geo_market',),
    'zip': ('zip',),
}


def _norm(text: str) -> str:
    return re.sub(r'\s+', ' ', (text or '').strip().lower())


def _score_name_match(query: str, candidate_name: str) -> int:
    q = _norm(query)
    n = _norm(candidate_name)
    if not q or not n:
        return 0
    if q == n:
        return 80
    if n.startswith(q) or q.startswith(n.split(',')[0]):
        return 60
    if q in n:
        return 45
    # Token overlap
    q_tokens = set(q.replace(',', ' ').split())
    n_tokens = set(n.replace(',', ' ').split())
    overlap = len(q_tokens & n_tokens)
    return min(40, overlap * 15)


def _score_type_match(hint: str, candidate_type: str, type_map: dict[str, tuple[str, ...]]) -> int:
    if hint == 'auto':
        return 5
    ct = _norm(candidate_type)
    for accepted in type_map.get(hint, (hint,)):
        if accepted in ct or ct in accepted:
            return 35
    return 0


def pick_best_google_result(
    spec: GeoLocationSpec,
    results: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not results:
        return None
    best_score = -1
    best: dict[str, Any] | None = None
    ctx = (spec.country_context or '').upper()
    hint = spec.location_type
    iso_query = spec.name.strip().upper() if hint == 'country' and len(spec.name.strip()) == 2 else ''

    for row in results:
        score = _score_name_match(spec.name, str(row.get('name') or ''))
        score += _score_type_match(hint, str(row.get('target_type') or ''), _GOOGLE_TYPE_HINTS)
        rcc = str(row.get('country_code') or '').upper()
        if ctx and rcc == ctx:
            score += 25
        if iso_query and rcc == iso_query:
            score += 50
        if score > best_score:
            best_score = score
            best = row

    if best is None or best_score < 25:
        return None
    return best


def pick_best_meta_result(
    spec: GeoLocationSpec,
    results: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not results:
        return None
    best_score = -1
    best: dict[str, Any] | None = None
    ctx = (spec.country_context or '').upper()
    hint = spec.location_type

    for row in results:
        score = _score_name_match(spec.name, str(row.get('name') or ''))
        score += _score_type_match(hint, str(row.get('type') or ''), _META_TYPE_HINTS)
        rcc = str(row.get('country_code') or '').upper()
        if ctx and rcc == ctx:
            score += 25
        if score > best_score:
            best_score = score
            best = row

    if best is None or best_score < 25:
        return None
    return best
