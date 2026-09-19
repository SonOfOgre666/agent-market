"""Google Ads Keyword Plan — GenerateKeywordIdeas."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from .api import GoogleAdsException, digits_customer_id, format_google_ads_exception, load_client

# Google Ads languageConstants/{id}
_DEFAULT_LANGUAGE_BY_COUNTRY: Dict[str, str] = {
    'MA': '1002',  # French
    'FR': '1002',
    'BE': '1002',
    'CA': '1000',
    'US': '1000',
    'GB': '1000',
    'DE': '1001',
    'ES': '1003',
    'IT': '1004',
    'PT': '1014',
    'NL': '1010',
    'SA': '1019',
    'AE': '1019',
    'EG': '1019',
}
_DEFAULT_LANGUAGE_ID = '1000'


def resolve_language_id(
    *,
    language_id: str | None = None,
    geo_countries: List[str] | None = None,
) -> str:
    if language_id and str(language_id).strip().isdigit():
        return str(language_id).strip()
    for country in geo_countries or []:
        code = str(country or '').strip().upper()
        if code in _DEFAULT_LANGUAGE_BY_COUNTRY:
            return _DEFAULT_LANGUAGE_BY_COUNTRY[code]
    return _DEFAULT_LANGUAGE_ID


def generate_keyword_ideas(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    geo_target_constant_ids: Optional[List[Any]] = None,
    language_id: Optional[str] = None,
    geo_countries: Optional[List[str]] = None,
    seed_keywords: Optional[List[str]] = None,
    page_url: Optional[str] = None,
    limit: int = 40,
) -> Dict[str, Any]:
    """
    KeywordPlanIdeaService.GenerateKeywordIdeas — expand seeds and/or URL into ideas
    with monthly search volume and competition metrics.
    """
    cid = digits_customer_id(customer_id)
    if not cid:
        return {'ok': False, 'error': 'customer_id is required'}

    seeds = [str(k).strip() for k in (seed_keywords or []) if str(k).strip()]
    url = (page_url or '').strip()
    geo_ids = [str(g).strip() for g in (geo_target_constant_ids or []) if str(g).strip()]
    if not geo_ids:
        return {'ok': False, 'error': 'geo_target_constant_ids is required'}
    if not seeds and not url:
        return {'ok': False, 'error': 'seed_keywords or page_url is required'}

    lang = resolve_language_id(language_id=language_id, geo_countries=geo_countries)

    try:
        client = load_client(google_ads_client_config)
        svc = client.get_service('KeywordPlanIdeaService')
        gads = client.get_service('GoogleAdsService')

        request = client.get_type('GenerateKeywordIdeasRequest')
        request.customer_id = cid
        request.language = gads.language_constant_path(lang)
        request.geo_target_constants.extend(
            [f'geoTargetConstants/{gid}' for gid in geo_ids]
        )
        request.include_adult_keywords = False
        request.keyword_plan_network = client.enums.KeywordPlanNetworkEnum.GOOGLE_SEARCH

        if seeds and url:
            request.keyword_and_url_seed.url = url
            request.keyword_and_url_seed.keywords.extend(seeds)
        elif seeds:
            request.keyword_seed.keywords.extend(seeds)
        else:
            request.url_seed.url = url

        ideas = []
        for idea in svc.generate_keyword_ideas(request=request):
            metrics = idea.keyword_idea_metrics
            ideas.append(
                {
                    'text': str(idea.text or '').strip(),
                    'avg_monthly_searches': int(metrics.avg_monthly_searches or 0),
                    'competition': str(getattr(metrics.competition, 'name', '') or ''),
                    'competition_index': int(getattr(metrics, 'competition_index', 0) or 0),
                    'low_top_of_page_bid_micros': int(
                        getattr(metrics, 'low_top_of_page_bid_micros', 0) or 0
                    ),
                    'high_top_of_page_bid_micros': int(
                        getattr(metrics, 'high_top_of_page_bid_micros', 0) or 0
                    ),
                }
            )
            if len(ideas) >= max(1, int(limit or 40)):
                break

        return {
            'ok': True,
            'ideas': ideas,
            'language_id': lang,
            'geo_target_constant_ids': [int(g) for g in geo_ids if str(g).isdigit()],
            'seed_count': len(seeds),
            'page_url': url or None,
        }
    except GoogleAdsException as exc:
        return {'ok': False, 'error': format_google_ads_exception(exc)}
    except Exception as exc:
        return {'ok': False, 'error': str(exc)}
