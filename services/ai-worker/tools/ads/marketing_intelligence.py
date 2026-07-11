"""Ads marketing intelligence tools — LLM + Keyword Planner (agent-callable)."""

from __future__ import annotations

from typing import Any, Dict

from lib.ads_marketing_content import suggest_keywords_for_topic
from lib.planner.google_campaign_llm import (
    assess_search_promotion_context_with_llm,
    resolve_google_ad_copy,
)
from lib.planner.google_keyword_pipeline import run_search_keyword_pipeline
from lib.planner.meta_campaign_llm import (
    resolve_meta_ad_copy,
    resolve_meta_strategy_queries,
)
from tools.ads._errors import ToolValidationError


def _require_workspace(payload: Dict[str, Any]) -> str | None:
    wid = payload.get('workspace_id')
    return str(wid).strip() if wid else None


def run_google_generate_search_keywords(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Hybrid Search keywords: LLM seeds → Google Keyword Planner (when account + geo) → validation.
    Same pipeline as the Google Search agent review card.
    """
    prompt = (payload.get('prompt') or payload.get('topic') or payload.get('business_context') or '').strip()
    if not prompt:
        raise ToolValidationError('prompt or topic is required')

    business_context = (payload.get('business_context') or prompt).strip()
    geo_countries = payload.get('geo_countries') or (
        [str(payload.get('country')).upper()] if payload.get('country') else None
    )
    geo_ids = payload.get('geo_target_constant_ids')
    if not geo_ids and geo_countries:
        from lib.ads_marketing_content import _GEO_BY_ISO

        code = str(geo_countries[0]).upper()
        if code in _GEO_BY_ISO:
            geo_ids = [_GEO_BY_ISO[code]]

    result = run_search_keyword_pipeline(
        prompt=prompt,
        conversation_history=payload.get('conversation_history'),
        business_context=business_context,
        geo_countries=geo_countries,
        geo_target_constant_ids=geo_ids,
        final_url=payload.get('final_url') or payload.get('page_url') or payload.get('url'),
        base_payload=payload,
        workspace_id=_require_workspace(payload),
    )
    return {
        'ok': True,
        'keywords': result.keywords,
        'suggested_keywords': result.suggested_keywords,
        'keyword_seeds': result.keyword_seeds,
        'source': result.source,
    }


def run_google_generate_rsa_copy(payload: Dict[str, Any]) -> Dict[str, Any]:
    """LLM-generated Google Responsive Search Ad headlines and descriptions."""
    name = (payload.get('campaign_name') or payload.get('name') or '').strip()
    prompt = (payload.get('prompt') or name).strip()
    if not name and not prompt:
        raise ToolValidationError('campaign_name or prompt is required')

    headlines, descriptions, source = resolve_google_ad_copy(
        campaign_name=name or 'Campaign',
        prompt=prompt,
        conversation_history=payload.get('conversation_history'),
        business_context=payload.get('business_context'),
        final_url=payload.get('final_url') or payload.get('page_url'),
        campaign_type=str(payload.get('campaign_type') or 'search'),
        geo_countries=payload.get('geo_countries'),
        workspace_id=_require_workspace(payload),
    )
    return {'ok': True, 'headlines': headlines, 'descriptions': descriptions, 'source': source}


def run_google_suggest_keywords(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Keyword ideas for UI/research — LLM + Planner with search volume when available."""
    topic = (payload.get('topic') or payload.get('prompt') or '').strip()
    if not topic:
        raise ToolValidationError('topic is required')
    out = suggest_keywords_for_topic(
        topic=topic,
        country=str(payload.get('country') or 'US'),
        language=str(payload.get('language') or 'en'),
        workspace_id=_require_workspace(payload),
        account_id=payload.get('account_id'),
        page_url=payload.get('page_url') or payload.get('final_url'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'keyword suggestion failed')
    return out


def run_google_assess_promotion_context(payload: Dict[str, Any]) -> Dict[str, Any]:
    """LLM: is the offer clear enough to auto-generate Search keywords and copy?"""
    prompt = (payload.get('prompt') or '').strip()
    if not prompt:
        raise ToolValidationError('prompt is required')
    assessed = assess_search_promotion_context_with_llm(
        prompt=prompt,
        conversation_history=payload.get('conversation_history'),
        workspace_id=_require_workspace(payload),
    )
    if assessed is None:
        from lib.planner.google_campaign_llm import resolve_search_promotion_context

        clear, ctx = resolve_search_promotion_context(
            prompt=prompt,
            conversation_history=payload.get('conversation_history'),
            final_url=payload.get('final_url'),
            workspace_id=_require_workspace(payload),
        )
        return {
            'ok': True,
            'promotion_clear': clear,
            'business_context': ctx,
            'source': 'rules',
        }
    clear, ctx = assessed
    return {
        'ok': True,
        'promotion_clear': clear,
        'business_context': ctx,
        'source': 'llm',
    }


def run_meta_generate_ad_copy(payload: Dict[str, Any]) -> Dict[str, Any]:
    """LLM-generated Meta ad primary text, headline, and description."""
    name = (payload.get('campaign_name') or payload.get('name') or '').strip()
    objective = str(payload.get('objective') or 'OUTCOME_TRAFFIC').strip().upper()
    prompt = (payload.get('prompt') or name).strip()
    if not prompt:
        raise ToolValidationError('prompt or campaign_name is required')

    message, headline, description, source = resolve_meta_ad_copy(
        campaign_name=name or 'Campaign',
        objective=objective,
        prompt=prompt,
        conversation_history=payload.get('conversation_history'),
        workspace_id=_require_workspace(payload),
        link_url=payload.get('link_url') or payload.get('final_url'),
    )
    return {
        'ok': True,
        'message': message,
        'headline': headline,
        'description': description,
        'source': source,
    }


def run_meta_generate_audience_queries(payload: Dict[str, Any]) -> Dict[str, Any]:
    """LLM-generated geo + interest search queries for Meta audience research tools."""
    prompt = (payload.get('prompt') or '').strip()
    if not prompt:
        raise ToolValidationError('prompt is required')
    geo_countries = payload.get('geo_countries')
    if not geo_countries and payload.get('country'):
        geo_countries = [str(payload.get('country')).upper()]
    geo_query, interest_query = resolve_meta_strategy_queries(
        prompt=prompt,
        conversation_history=payload.get('conversation_history'),
        workspace_id=_require_workspace(payload),
        geo_countries=geo_countries,
    )
    return {
        'ok': True,
        'geo_query': geo_query,
        'interest_query': interest_query,
    }


def run_google_generate_search_marketing_bundle(payload: Dict[str, Any]) -> Dict[str, Any]:
    """One-shot Search marketing bundle: keywords + RSA copy (agent convenience)."""
    kw_out = run_google_generate_search_keywords(payload)
    copy_payload = dict(payload)
    if not copy_payload.get('prompt'):
        copy_payload['prompt'] = payload.get('prompt') or payload.get('topic') or ''
    rsa_out = run_google_generate_rsa_copy(copy_payload)
    return {
        'ok': True,
        'keywords': kw_out.get('keywords'),
        'suggested_keywords': kw_out.get('suggested_keywords'),
        'keyword_source': kw_out.get('source'),
        'headlines': rsa_out.get('headlines'),
        'descriptions': rsa_out.get('descriptions'),
        'copy_source': rsa_out.get('source'),
    }


def run_competitive_analysis(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Scrape competitor URLs + optional Meta Ads Library search → LLM strategic brief.
    Uses ads marketing LLM config (Settings → AI: Google Ads Marketing / planner).
    """
    from lib.competitive_intel import compact_ads_library_rows, scrape_competitor_pages
    from lib.prompt_loader import load_prompt
    from lib.planner.ads_llm import complete_ads_json_llm

    competitor = (payload.get('competitor_name') or payload.get('competitor') or '').strip()
    if not competitor:
        raise ToolValidationError('competitor_name is required')

    urls = payload.get('competitor_urls') or payload.get('urls') or []
    if isinstance(urls, str):
        urls = [u.strip() for u in urls.split(',') if u.strip()]
    pages = scrape_competitor_pages(list(urls))

    ads_rows: list[dict[str, Any]] = []
    ads_error: str | None = None
    search_terms = (payload.get('search_terms') or payload.get('ads_library_query') or competitor).strip()
    token = (payload.get('access_token') or '').strip()
    countries = payload.get('ad_reached_countries') or payload.get('countries')
    if token and search_terms and countries:
        from connectors.meta_ads.ads_library import search_ads_archive

        lib = search_ads_archive(
            token,
            search_terms=search_terms,
            ad_reached_countries=countries,
            limit=int(payload.get('ads_library_limit') or 15),
        )
        if lib.get('ok'):
            ads_rows = lib.get('data') or []
        else:
            ads_error = lib.get('error') or 'Meta Ads Library search failed'

    pages_block = '\n\n'.join(
        f"URL: {p.get('url')}\nTitle: {p.get('title') or '—'}\n"
        + (f"Text:\n{p.get('text')}" if p.get('ok') else f"Error: {p.get('error')}")
        for p in pages
    ) or '(no pages scraped)'

    ads_compact = compact_ads_library_rows(ads_rows)
    ads_block = (
        '\n'.join(
            f"- {a.get('page_name')}: {(a.get('ad_creative_body') or '')[:200]}"
            for a in ads_compact
        )
        if ads_compact
        else '(no ads library data — connect Meta account or omit countries)'
    )

    our_context = (
        payload.get('our_business_context')
        or payload.get('business_context')
        or payload.get('prompt')
        or 'Not specified'
    ).strip()

    llm_prompt = load_prompt(
        'ads/competitive_analysis.md',
        our_context=our_context,
        competitor_name=competitor,
        pages_block=pages_block,
        ads_library_block=ads_block,
    )

    analysis = complete_ads_json_llm(
        workspace_id=_require_workspace(payload),
        prompt=llm_prompt,
        source='competitive_analysis',
        temperature=0.25,
        max_tokens=2048,
        opcode='google_search_marketing',
    )

    if not analysis:
        return {
            'ok': True,
            'competitor_name': competitor,
            'pages_scraped': pages,
            'ads_library_count': len(ads_compact),
            'ads_library_error': ads_error,
            'analysis': {
                'competitor_name': competitor,
                'positioning_summary': 'AI analysis unavailable — configure Google Ads Marketing in Settings → AI.',
                'strengths': [],
                'weaknesses': [],
                'messaging_themes': [],
                'keyword_opportunities': [],
                'content_gaps': [],
                'ad_creative_insights': [],
                'recommended_actions': [],
            },
            'source': 'scrape_only',
        }

    return {
        'ok': True,
        'competitor_name': competitor,
        'pages_scraped': pages,
        'ads_library_count': len(ads_compact),
        'ads_library_error': ads_error,
        'analysis': analysis,
        'source': 'llm',
    }
