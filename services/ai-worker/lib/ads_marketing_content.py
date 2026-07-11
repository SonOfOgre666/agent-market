"""Ads marketing content — LLM + Google Keyword Planner (no API stubs)."""

from __future__ import annotations

import logging
import re
from typing import Any

from lib.google_geo_targets import geo_target_id_for_iso

logger = logging.getLogger(__name__)

_LANGUAGE_NAME: dict[str, str] = {
    'en': 'English',
    'fr': 'French',
    'es': 'Spanish',
    'de': 'German',
    'ar': 'Arabic',
    'it': 'Italian',
    'pt': 'Portuguese',
    'nl': 'Dutch',
    'tr': 'Turkish',
}


def _language_label(code: str | None) -> str:
    key = (code or 'en').strip().lower()[:2]
    return _LANGUAGE_NAME.get(key, key.upper() if len(key) == 2 else 'English')


def _competition_to_cpc(idea: dict[str, Any]) -> tuple[float | None, float | None]:
    low = idea.get('low_top_of_page_bid_micros')
    high = idea.get('high_top_of_page_bid_micros')
    if low is None and high is None:
        return None, None
    cpc_min = round(int(low or 0) / 1_000_000, 2) if low else None
    cpc_max = round(int(high or 0) / 1_000_000, 2) if high else None
    return cpc_min, cpc_max


def _keyword_suggestion_row(
    text: str,
    *,
    avg_monthly_searches: int | None = None,
    competition: str | None = None,
    cpc_min: float | None = None,
    cpc_max: float | None = None,
) -> dict[str, Any]:
    return {
        'keyword': text,
        'avgMonthlySearches': avg_monthly_searches,
        'competition': competition,
        'cpcMin': cpc_min,
        'cpcMax': cpc_max,
    }


def suggest_keywords_for_topic(
    *,
    topic: str,
    country: str = 'US',
    language: str = 'en',
    workspace_id: str | None = None,
    account_id: str | None = None,
    page_url: str | None = None,
) -> dict[str, Any]:
    """Hybrid keyword suggestions: LLM seeds → Google Keyword Planner → validation."""
    from lib.planner.google_campaign_llm import generate_seed_keywords_with_llm
    from lib.planner.google_keyword_pipeline import (
        rank_keyword_ideas,
        validate_keywords,
    )

    topic = (topic or '').strip()
    if not topic:
        return {'ok': False, 'error': 'topic is required'}

    country_code = (country or 'US').strip().upper()
    geo_id = geo_target_id_for_iso(country_code)
    geo_ids = [geo_id] if geo_id else None
    prompt = f'Generate keyword ideas for: {topic}'

    llm_seeds = generate_seed_keywords_with_llm(
        prompt=prompt,
        conversation_history=[],
        business_context=topic,
        geo_countries=[country_code],
        final_url=page_url,
        workspace_id=workspace_id,
    )
    seeds = validate_keywords(llm_seeds) if llm_seeds else []
    if not seeds:
        raise RuntimeError(
            'Keyword seed generation failed. Configure Google Ads Marketing AI and try again.'
        )

    source = 'llm'
    ideas: list[dict[str, Any]] | None = None

    if account_id and geo_ids:
        try:
            from connectors.google_ads.keyword_plan import generate_keyword_ideas
            from tools.ads._resolve import enrich_ads_tool_payload

            body = enrich_ads_tool_payload(
                'google_generate_keyword_ideas',
                {
                    'account_id': account_id,
                    'workspace_id': workspace_id,
                    'seed_keywords': seeds,
                    'geo_target_constant_ids': geo_ids,
                    'geo_countries': [country_code],
                    'page_url': page_url,
                },
            )
            gcfg = body.get('google_ads_client_config')
            customer_id = body.get('customer_id')
            if gcfg and customer_id:
                out = generate_keyword_ideas(
                    gcfg,
                    customer_id=str(customer_id),
                    geo_target_constant_ids=geo_ids,
                    geo_countries=[country_code],
                    seed_keywords=seeds,
                    page_url=page_url,
                    limit=30,
                )
                if out.get('ok'):
                    ideas = rank_keyword_ideas(out.get('ideas') or [])
                    source = 'llm+planner' if llm_seeds else 'planner'
        except Exception as exc:
            logger.info('keyword planner for suggest API unavailable: %s', exc)

    suggestions: list[dict[str, Any]] = []
    if ideas:
        for idea in ideas[:20]:
            cpc_min, cpc_max = _competition_to_cpc(idea)
            suggestions.append(
                _keyword_suggestion_row(
                    str(idea.get('text') or ''),
                    avg_monthly_searches=int(idea.get('avg_monthly_searches') or 0),
                    competition=str(idea.get('competition') or '') or None,
                    cpc_min=cpc_min,
                    cpc_max=cpc_max,
                )
            )
    else:
        for kw in seeds[:20]:
            suggestions.append(_keyword_suggestion_row(kw))

    return {
        'ok': True,
        'topic': topic,
        'language': language,
        'country': country_code,
        'suggestions': suggestions,
        'source': source,
    }


def generate_campaign_search_assets(
    *,
    campaign_name: str,
    keywords: list[str] | None = None,
    workspace_id: str | None = None,
    language: str = 'en',
) -> dict[str, Any]:
    """Google RSA headlines + descriptions via LLM."""
    from lib.planner.google_campaign_llm import resolve_google_ad_copy

    kw_list = [str(k).strip() for k in (keywords or []) if str(k).strip()]
    prompt = (
        f'Campaign: {campaign_name}\n'
        f'Keywords: {", ".join(kw_list) if kw_list else campaign_name}\n'
        f'Language: {_language_label(language)}'
    )

    headlines, descriptions, source = resolve_google_ad_copy(
        campaign_name=campaign_name,
        prompt=prompt,
        conversation_history=[],
        business_context=campaign_name,
        final_url=None,
        campaign_type='search',
        geo_countries=None,
        workspace_id=workspace_id,
    )

    return {
        'headlines': headlines[:10],
        'descriptions': descriptions[:4],
        'source': source,
    }


def generate_landing_page_marketing_content(
    *,
    campaign_name: str,
    workspace_id: str | None = None,
    keywords: list[str] | None = None,
    language: str = 'en',
) -> dict[str, Any]:
    """Landing page hero + body via LLM."""
    lang = _language_label(language)
    kw_line = ', '.join(str(k) for k in (keywords or [])[:12]) or campaign_name

    from lib.prompt_loader import load_prompt

    llm_prompt = load_prompt(
        'ads/landing_page_copy.md',
        campaign_name=campaign_name,
        keywords_line=kw_line,
        language_label=lang,
    )

    content: dict[str, Any] | None = None
    source = 'llm'
    try:
        from lib.ai_workspace_config import get_ads_marketing_config
        from lib.llm import text as text_llm
        from lib.llm.json_utils import parse_json_text

        cfg = get_ads_marketing_config(workspace_id, 'landing_page_copy')

        if cfg:
            raw = text_llm.complete(
                cfg['provider'],
                cfg['model'],
                llm_prompt,
                workspace_id=workspace_id,
                temperature=0.35,
                max_tokens=500,
                api_model_id=cfg.get('api_model_id'),
                feature_id=cfg.get('feature_id'),
                opcode='landing_page_copy',
                source='ads_marketing_content',
                record_usage=True,
            )
            parsed = parse_json_text(raw, {})
            if isinstance(parsed, dict) and parsed.get('headline'):
                content = {
                    'headline': str(parsed.get('headline') or '').strip(),
                    'subheadline': str(parsed.get('subheadline') or '').strip(),
                    'body': str(parsed.get('body') or '').strip(),
                    'cta_text': str(parsed.get('cta_text') or 'Get started').strip(),
                }
    except Exception as exc:
        logger.warning('landing page LLM failed: %s', exc)

    if not content or not content.get('headline'):
        raise RuntimeError(
            'Landing page copy generation failed. Configure landing page copy AI under Settings → AI Integrations.'
        )

    return {**content, 'source': source}
