"""
Planner routing — keyword heuristics used only when orchestrator LLM is unavailable.

Primary ads/social routing: orchestrator LLM (orchestrator.py) + workflow specs.
This module filters the tool catalog for the JSON planner (social analytics, general).
"""

from __future__ import annotations

import re
from typing import Any, Literal

from lib.planner.ads_helpers import (
    detect_ads_mode,
    detect_ads_platform,
    is_actionable_ads_request,
)
from lib.planner.social_helpers import is_actionable_social_request
from lib.planner.landing_page_helpers import is_actionable_landing_page_request
from lib.planner.seo_helpers import is_actionable_seo_request

PlannerRoute = Literal[
    'social_content',
    'meta_ads_campaign',
    'meta_ads_analytics',
    'google_ads_campaign',
    'google_ads_analytics',
    'seo_marketing',
    'landing_page',
    'mixed',
    'informational',
    'general',
]

_SOCIAL_TOOL_IDS = frozenset({
    'generate_social_post',
    'analyze_social_comment',
    'generate_video_script',
    'generate_image_script',
    'generate_image',
    'generate_video',
    'create_draft_post',
    'schedule_post',
    'publish_post',
})

_SEO_TOOL_IDS = frozenset({
    'cluster_seo_keywords',
    'check_seo_keyword_ranks',
    'audit_seo_landing_pages',
    'analyze_competitive_landscape',
})

_INTERNAL_TOOL_IDS = frozenset({
    'run_landing_page_workflow',
})

_META_MUTATING_MARKERS = (
    'create_',
    'update_',
    'upload_',
    'publish_',
    'duplicate_',
)

_GOOGLE_ANALYTICS_MARKERS = (
    'report_',
    'docs_',
    'suggest_',
    'get_location_performance',
    'get_device_performance',
    'get_recommendations',
    'get_change_history',
    'optimize_geographic',
    'list_audiences',
)


def message_mentions_ads(message: str) -> bool:
    """Broader than is_actionable_ads_request — catches 'Meta advertising setup', etc."""
    if is_actionable_ads_request(message):
        return True
    m = (message or '').lower()
    if len(m) < 8:
        return False
    if any(
        k in m
        for k in (
            'meta advertising',
            'advertising setup',
            'meta campaign',
            'facebook campaign',
            'meta ad',
            'fb ad',
            'google campaign',
            'search ads',
            'ad creative',
            'ad set',
            'adset',
        )
    ):
        return True
    if 'meta' in m and any(
        k in m for k in ('campaign', 'targeting', 'pixel', 'advertising', 'ad account', 'creatives')
    ):
        return True
    if 'advertising' in m and any(
        k in m for k in ('campaign', 'setup', 'targeting', 'creatives', 'structure')
    ):
        return True
    return False


def route_planner_intent(message: str, ctx: dict[str, Any]) -> PlannerRoute:
    """Pick which tool families the planner should see."""
    social = is_actionable_social_request(message)
    seo = is_actionable_seo_request(message)
    landing = is_actionable_landing_page_request(message)
    ads = message_mentions_ads(message)
    platform = detect_ads_platform(message, ctx)
    mode = detect_ads_mode(message)

    if social and ads:
        return 'mixed'
    if landing and not ads:
        return 'landing_page'
    if seo and not ads and not landing:
        return 'seo_marketing'

    if ads or platform != 'unknown':
        analytics_modes = frozenset({'report', 'list'})
        if platform == 'google_ads':
            return 'google_ads_analytics' if mode in analytics_modes else 'google_ads_campaign'
        if platform == 'meta_ads':
            return 'meta_ads_analytics' if mode in analytics_modes else 'meta_ads_campaign'
        m = (message or '').lower()
        if 'google' in m or 'gaql' in m or 'rsa' in m:
            return 'google_ads_analytics' if mode in analytics_modes else 'google_ads_campaign'
        return 'meta_ads_analytics' if mode in analytics_modes else 'meta_ads_campaign'

    if social:
        return 'social_content'

    return 'general'


def _is_meta_analytics_tool(tool_id: str) -> bool:
    if not tool_id.startswith('meta_'):
        return False
    return not any(marker in tool_id for marker in _META_MUTATING_MARKERS)


_ADS_WORKFLOW_TOOL_IDS = frozenset()


def _is_meta_campaign_tool(tool_id: str) -> bool:
    return tool_id.startswith('meta_')


def _is_google_analytics_tool(tool_id: str) -> bool:
    if not tool_id.startswith('google_'):
        return False
    if any(marker in tool_id for marker in _GOOGLE_ANALYTICS_MARKERS):
        return True
    return tool_id in {
        'google_get_ad_accounts',
        'google_get_account',
        'google_get_campaign',
        'google_get_account_hierarchy',
        'google_get_ad_group',
        'google_list_campaigns',
        'google_list_ad_groups',
        'google_list_keywords',
        'google_list_ads_read',
        'google_list_budgets',
        'google_list_extensions',
        'google_list_assets',
    }


def _is_google_campaign_tool(tool_id: str) -> bool:
    return tool_id.startswith('google_')


def tool_id_allowed_for_route(tool_id: str, route: PlannerRoute) -> bool:
    if route == 'informational':
        return False
    if route == 'general':
        return True
    if route == 'social_content':
        return tool_id in _SOCIAL_TOOL_IDS
    if route == 'seo_marketing':
        return tool_id in _SEO_TOOL_IDS
    if route == 'landing_page':
        return tool_id in _INTERNAL_TOOL_IDS
    if route == 'meta_ads_campaign':
        return _is_meta_campaign_tool(tool_id)
    if route == 'meta_ads_analytics':
        return _is_meta_analytics_tool(tool_id)
    if route == 'google_ads_campaign':
        return _is_google_campaign_tool(tool_id)
    if route == 'google_ads_analytics':
        return _is_google_analytics_tool(tool_id)
    if route == 'mixed':
        return (
            tool_id in _SOCIAL_TOOL_IDS
            or _is_meta_campaign_tool(tool_id)
            or _is_google_campaign_tool(tool_id)
        )
    return True


def route_workflow_intent(route: PlannerRoute) -> str:
    """Map router route → workflow graph intent field."""
    if route == 'social_content':
        return 'social_content'
    if route == 'seo_marketing':
        return 'seo_marketing'
    if route == 'landing_page':
        return 'landing_page'
    if route in ('meta_ads_analytics', 'google_ads_analytics'):
        return 'analytics'
    if route in ('meta_ads_campaign', 'google_ads_campaign', 'mixed'):
        return 'ads_campaign'
    return 'mixed'


def format_route_hint(route: PlannerRoute) -> str:
    hints = {
        'social_content': 'Plan a social_content workflow using only social post tools.',
        'seo_marketing': 'Plan an seo_marketing workflow using SEO tools (cluster_seo_keywords, check_seo_keyword_ranks, audit_seo_landing_pages, analyze_competitive_landscape).',
        'landing_page': 'Plan a landing_page workflow using run_landing_page_workflow only.',
        'meta_ads_campaign': 'Plan an ads_campaign workflow using Meta (meta_*) tools only — never Google tool_ids.',
        'meta_ads_analytics': 'Plan an analytics workflow using Meta read/report/search tools only — no mutating meta_* steps.',
        'google_ads_campaign': 'Plan an ads_campaign workflow using Google (google_*) tools only — never Meta tool_ids.',
        'google_ads_analytics': 'Plan an analytics workflow using Google read/report tools only.',
        'mixed': 'The user asked for both social and ads actions — plan separate steps; never mix Meta and Google tool_ids in one chain.',
        'informational': 'Answer in assistant_message with intent informational and zero steps.',
        'general': 'Pick the smallest valid workflow from the catalog.',
    }
    return hints.get(route, hints['general'])
