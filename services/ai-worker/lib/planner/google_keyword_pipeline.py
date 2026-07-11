"""Hybrid Search keyword pipeline: LLM seeds → Google Keyword Planner → rule validation."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any

from lib.planner.google_campaign_llm import generate_seed_keywords_with_llm

logger = logging.getLogger(__name__)

KeywordSource = str  # 'llm+planner' | 'planner' | 'llm' | 'fallback'

_MAX_KEYWORD_LEN = 80
_PRIMARY_KEYWORD_COUNT = 6
_SUGGESTED_KEYWORD_COUNT = 6

# Reject overly broad / low-intent single concepts
_BROAD_REJECT: frozenset[str] = frozenset(
    {
        'wellness',
        'nutrition',
        'exercise',
        'healthy lifestyle',
        'lifestyle',
        'health',
        'fitness journey',
        'fitness',
        'gym',
        'workout',
    }
)


@dataclass
class KeywordPipelineResult:
    keywords: list[str]
    suggested_keywords: list[str]
    keyword_seeds: list[str]
    source: KeywordSource


def normalize_keyword(text: str) -> str:
    return re.sub(r'\s+', ' ', (text or '').strip().lower())


def is_valid_keyword(text: str) -> bool:
    kw = normalize_keyword(text)
    if not kw or len(kw) > _MAX_KEYWORD_LEN:
        return False
    if kw in _BROAD_REJECT:
        return False
    words = kw.split()
    if len(words) == 1 and kw in _BROAD_REJECT:
        return False
    return True


def validate_keywords(keywords: list[str] | None) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in keywords or []:
        if not is_valid_keyword(raw):
            continue
        key = normalize_keyword(raw)
        if key in seen:
            continue
        seen.add(key)
        out.append(raw.strip())
    return out


def rank_keyword_ideas(ideas: list[dict[str, Any]]) -> list[dict[str, Any]]:
    def score(item: dict[str, Any]) -> tuple[int, int]:
        searches = int(item.get('avg_monthly_searches') or 0)
        comp_idx = int(item.get('competition_index') or 0)
        return (searches, -comp_idx)

    valid = [i for i in ideas if is_valid_keyword(str(i.get('text') or ''))]
    return sorted(valid, key=score, reverse=True)


def emergency_keyword_seeds(
    *,
    business_context: str | None,
    geo_countries: list[str] | None,
) -> list[str]:
    """Minimal generic seeds when LLM and Google Planner are unavailable — not vertical-specific."""
    base = (business_context or 'your offer').strip()
    geo_tail = ''
    if geo_countries and 'MA' in geo_countries:
        geo_tail = ' morocco'
    seeds = [
        base,
        f'{base}{geo_tail}'.strip(),
        f'buy {base}'.strip(),
        f'best {base}'.strip(),
    ]
    return validate_keywords(seeds)[:6]


def _split_primary_suggested(texts: list[str]) -> tuple[list[str], list[str]]:
    primary = texts[:_PRIMARY_KEYWORD_COUNT]
    suggested = texts[_PRIMARY_KEYWORD_COUNT : _PRIMARY_KEYWORD_COUNT + _SUGGESTED_KEYWORD_COUNT]
    return primary, suggested


def _try_google_planner(
    *,
    base_payload: dict[str, Any],
    seed_keywords: list[str],
    final_url: str | None,
    geo_target_constant_ids: list[int] | None,
    geo_countries: list[str] | None,
) -> list[dict[str, Any]] | None:
    if not geo_target_constant_ids:
        return None
    try:
        from connectors.google_ads.api import health_check
        from connectors.google_ads.keyword_plan import generate_keyword_ideas
        from tools.ads._resolve import enrich_ads_tool_payload
    except Exception:
        return None

    if not health_check():
        return None

    body = enrich_ads_tool_payload(
        'google_generate_keyword_ideas',
        {
            'account_id': base_payload.get('account_id'),
            'workspace_id': base_payload.get('workspace_id'),
        },
    )
    gcfg = body.get('google_ads_client_config')
    customer_id = body.get('customer_id')
    if not gcfg or not customer_id:
        return None

    out = generate_keyword_ideas(
        gcfg,
        customer_id=str(customer_id),
        geo_target_constant_ids=geo_target_constant_ids,
        geo_countries=geo_countries,
        seed_keywords=seed_keywords,
        page_url=final_url,
        limit=40,
    )
    if not out.get('ok'):
        logger.info('keyword planner unavailable: %s', out.get('error'))
        return None
    return out.get('ideas') or []


def run_search_keyword_pipeline(
    *,
    prompt: str,
    conversation_history: list[dict[str, Any]] | None,
    business_context: str | None,
    geo_countries: list[str] | None,
    geo_target_constant_ids: list[int] | None,
    final_url: str | None,
    base_payload: dict[str, Any],
    workspace_id: str | None = None,
) -> KeywordPipelineResult:
    """
    Best: LLM seeds → Google Keyword Planner → validation rules
    Good: Google Keyword Planner (URL or generic seeds) → validation rules
    Acceptable: LLM seeds → validation rules
    Emergency: generic business-based seeds only (no vertical lists)
    """
    llm_seeds = generate_seed_keywords_with_llm(
        prompt=prompt,
        conversation_history=conversation_history,
        business_context=business_context,
        geo_countries=geo_countries,
        final_url=final_url,
        workspace_id=workspace_id or base_payload.get('workspace_id'),
    )
    llm_seeds = validate_keywords(llm_seeds) if llm_seeds else []

    ideas: list[dict[str, Any]] | None = None
    seeds_for_planner = llm_seeds

    if geo_target_constant_ids:
        if seeds_for_planner:
            ideas = _try_google_planner(
                base_payload=base_payload,
                seed_keywords=seeds_for_planner,
                final_url=final_url,
                geo_target_constant_ids=geo_target_constant_ids,
                geo_countries=geo_countries,
            )
        if not ideas and final_url:
            ideas = _try_google_planner(
                base_payload=base_payload,
                seed_keywords=[],
                final_url=final_url,
                geo_target_constant_ids=geo_target_constant_ids,
                geo_countries=geo_countries,
            )
        if not ideas and not seeds_for_planner:
            raise RuntimeError(
                'Google Keyword Planner returned no ideas and no LLM seeds were available. '
                'Provide business context or seed keywords.'
            )

    if ideas:
        ranked = rank_keyword_ideas(ideas)
        texts = validate_keywords([str(i.get('text') or '') for i in ranked])
        if texts:
            primary, suggested = _split_primary_suggested(texts)
            source: KeywordSource = 'llm+planner' if llm_seeds else 'planner'
            return KeywordPipelineResult(
                keywords=primary,
                suggested_keywords=suggested,
                keyword_seeds=seeds_for_planner,
                source=source,
            )

    if llm_seeds:
        primary, suggested = _split_primary_suggested(llm_seeds)
        return KeywordPipelineResult(
            keywords=primary,
            suggested_keywords=suggested,
            keyword_seeds=llm_seeds,
            source='llm',
        )

    raise RuntimeError(
        'Keyword pipeline could not produce keywords. Configure Google Ads Marketing AI, '
        'connect Google Ads with geo targeting, or provide seed keywords in your message.'
    )


def apply_keyword_edits(keywords: list[str] | None, prompt: str) -> list[str]:
    """Parse ADD / REMOVE from the latest user message."""
    result = list(keywords or [])
    text = prompt or ''
    if not re.search(r'\b(ADD|REMOVE)\b', text, re.I):
        return result

    for m in re.finditer(
        r'\bREMOVE\s+(.+?)(?=\s+ADD\b|\s+REMOVE\b|$)',
        text,
        re.I | re.S,
    ):
        target = normalize_keyword(m.group(1).strip().strip('"\''))
        result = [k for k in result if normalize_keyword(k) != target]

    for m in re.finditer(
        r'\bADD\s+(.+?)(?=\s+ADD\b|\s+REMOVE\b|$)',
        text,
        re.I | re.S,
    ):
        raw = m.group(1).strip().strip('"\'')
        if is_valid_keyword(raw):
            keys = {normalize_keyword(k) for k in result}
            if normalize_keyword(raw) not in keys:
                result.append(raw.strip())

    return validate_keywords(result)


def is_keyword_edit_message(prompt: str) -> bool:
    return bool(re.search(r'\b(ADD|REMOVE)\s+', prompt or '', re.I))


def extract_keywords_from_review_history(
    history: list[dict[str, Any]] | None,
) -> list[str] | None:
    """Recover keyword list from the last Google Campaign Review assistant message."""
    for msg in reversed(history or []):
        if str(msg.get('role') or '') != 'assistant':
            continue
        content = str(msg.get('content') or '')
        if 'Google Campaign Review' not in content:
            continue
        kws: list[str] = []
        in_generated = False
        for line in content.splitlines():
            if line.strip().startswith('Generated keywords'):
                in_generated = True
                continue
            if in_generated and line.strip().startswith('Suggested keywords'):
                break
            if in_generated:
                m = re.match(r'^\s*(?:✓|•)\s+(.+)$', line)
                if m:
                    kws.append(m.group(1).strip())
        if kws:
            return kws
    return None
