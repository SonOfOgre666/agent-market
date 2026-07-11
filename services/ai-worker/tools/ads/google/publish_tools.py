"""Google Ads publish + discovery tool wrappers."""

from __future__ import annotations

from typing import Any, Dict

from connectors.google_ads.geo_search import search_geo_target_constants
from connectors.google_ads.keyword_plan import generate_keyword_ideas
from connectors.google_ads.languages import create_language_targeting
from connectors.google_ads.merchants import list_merchant_center_links
from connectors.google_ads.publish_app import publish_app_campaign
from connectors.google_ads.publish_display import publish_display_campaign
from connectors.google_ads.publish_local import publish_local_campaign
from connectors.google_ads.publish_performance_max import publish_performance_max_campaign
from connectors.google_ads.publish_search import publish_search_campaign
from connectors.google_ads.publish_shopping import publish_shopping_campaign
from connectors.google_ads.publish_video import publish_video_campaign
from tools.ads.google._config import require_google_config
from tools.ads.google.publish_typed import run_typed_publish
from tools.ads._errors import ToolValidationError


def run_generate_keyword_ideas(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, customer_id = require_google_config(payload)
    seeds = payload.get('seed_keywords') or payload.get('keywords') or []
    if isinstance(seeds, str):
        seeds = [s.strip() for s in seeds.split(',') if s.strip()]
    geo_ids = (
        payload.get('geo_target_constant_ids')
        or payload.get('location_ids')
        or payload.get('geo_ids')
        or []
    )
    out = generate_keyword_ideas(
        gcfg,
        customer_id=customer_id,
        geo_target_constant_ids=geo_ids,
        language_id=payload.get('language_id'),
        geo_countries=payload.get('geo_countries'),
        seed_keywords=list(seeds) if isinstance(seeds, list) else [],
        page_url=payload.get('page_url') or payload.get('final_url') or payload.get('url'),
        limit=int(payload.get('limit') or 40),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'generate keyword ideas failed')
    return out


def run_search_geo_locations(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, customer_id = require_google_config(payload)
    query = (payload.get('query') or '').strip()
    if not query:
        raise ToolValidationError('query is required')
    out = search_geo_target_constants(
        gcfg,
        customer_id=customer_id,
        query=query,
        locale=str(payload.get('locale') or 'en'),
        country_code=payload.get('country_code'),
        limit=int(payload.get('limit') or 25),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'search geo failed')
    return out


def run_add_language_targeting(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, customer_id = require_google_config(payload)
    out = create_language_targeting(
        gcfg,
        customer_id=customer_id,
        campaign_resource_name=payload.get('campaign_resource_name'),
        platform_campaign_id=payload.get('platform_campaign_id') or payload.get('campaign_id'),
        language_ids=payload.get('language_ids'),
        languages=payload.get('languages') or payload.get('target_languages'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'language targeting failed')
    return out


def run_list_merchant_centers(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, customer_id = require_google_config(payload)
    return list_merchant_center_links(gcfg, customer_id=customer_id)


def run_publish_search(payload: Dict[str, Any]) -> Dict[str, Any]:
    return run_typed_publish(payload, publisher=publish_search_campaign, default_type='search')


def run_publish_display(payload: Dict[str, Any]) -> Dict[str, Any]:
    return run_typed_publish(payload, publisher=publish_display_campaign, default_type='display')


def run_publish_video(payload: Dict[str, Any]) -> Dict[str, Any]:
    return run_typed_publish(payload, publisher=publish_video_campaign, default_type='video')


def run_publish_shopping(payload: Dict[str, Any]) -> Dict[str, Any]:
    return run_typed_publish(payload, publisher=publish_shopping_campaign, default_type='shopping')


def run_publish_performance_max(payload: Dict[str, Any]) -> Dict[str, Any]:
    return run_typed_publish(payload, publisher=publish_performance_max_campaign, default_type='performance_max')


def run_publish_app(payload: Dict[str, Any]) -> Dict[str, Any]:
    return run_typed_publish(payload, publisher=publish_app_campaign, default_type='app')


def run_publish_local(payload: Dict[str, Any]) -> Dict[str, Any]:
    return run_typed_publish(payload, publisher=publish_local_campaign, default_type='local')
