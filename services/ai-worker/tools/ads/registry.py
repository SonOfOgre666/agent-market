"""Ads tool dispatch — maps tool_id to run(payload)."""

from __future__ import annotations

from typing import Any, Callable, Dict

from tools.ads import marketing_intelligence as ads_marketing_intel
from tools.ads._resolve import enrich_ads_tool_payload
from tools.ads.google import create_campaign as google_create_campaign
from tools.ads.meta import create_adset as meta_create_adset
from tools.ads.meta import create_campaign as meta_create_campaign
from tools.ads.meta import get_account as meta_get_account
from tools.ads.meta import get_accounts as meta_get_accounts
from tools.ads.meta import search_ads_library as meta_search_ads_library
from tools.ads.meta import get_ad as meta_get_ad
from tools.ads.meta import get_ad_creatives as meta_get_ad_creatives
from tools.ads.meta import get_adset as meta_get_adset
from tools.ads.meta import get_campaign as meta_get_campaign
from tools.ads.meta import get_creative as meta_get_creative
from tools.ads.meta import list_ads as meta_list_ads
from tools.ads.meta import list_adsets as meta_list_adsets
from tools.ads.meta import list_campaigns as meta_list_campaigns
from tools.ads.meta import update_ad as meta_update_ad
from tools.ads.meta import update_adset as meta_update_adset
from tools.ads.meta import update_campaign as meta_update_campaign
from tools.ads.meta import update_creative as meta_update_creative
from tools.ads.meta import upload_ad_image as meta_upload_ad_image
from tools.ads.meta import upload_ad_video as meta_upload_ad_video
from tools.ads.meta import compute_image_crops as meta_compute_image_crops
from tools.ads.meta import get_account_pages as meta_get_account_pages
from tools.ads.meta import create_ad_pixel as meta_create_ad_pixel
from tools.ads.meta import get_ad_pixel as meta_get_ad_pixel
from tools.ads.meta import list_ad_pixels as meta_list_ad_pixels
from tools.ads.meta import update_ad_pixel as meta_update_ad_pixel
from tools.ads.meta import get_ad_image as meta_get_ad_image
from tools.ads.meta import get_ad_video as meta_get_ad_video
from tools.ads.meta import search_pages_by_name as meta_search_pages_by_name
from tools.ads.google import add_keywords as google_add_keywords
from tools.ads.google import add_negative_keywords as google_add_negative_keywords
from tools.ads.google import create_ad as google_create_ad
from tools.ads.google import create_adgroup as google_create_adgroup
from tools.ads.google import create_budget as google_create_budget
from tools.ads.google import docs_gaql as google_docs_gaql
from tools.ads.google import docs_reporting_fields as google_docs_reporting_fields
from tools.ads.google import docs_reporting_views as google_docs_reporting_views
from tools.ads.google import create_geo_targeting as google_create_geo_targeting
from tools.ads.google import create_search_campaign as google_create_search_campaign
from tools.ads.google import create_typed_campaign as google_create_typed_campaign
from tools.ads.google import create_campaign_with_budget as google_create_campaign_with_budget
from tools.ads.google import exclude_geo_targets as google_exclude_geo_targets
from tools.ads.google import get_account as google_get_account
from tools.ads.google import get_accounts as google_get_accounts
from tools.ads.google import get_campaign as google_get_campaign
from tools.ads.google import list_ad_groups as google_list_ad_groups
from tools.ads.google import list_campaigns as google_list_campaigns
from tools.ads.google import publish as google_publish
from tools.ads.google import publish_tools as google_publish_tools
from tools.ads.google import resolve_geo_targeting as google_resolve_geo_targeting
from tools.ads.google import pause_campaign as google_pause_campaign
from tools.ads.google import resume_campaign as google_resume_campaign
from tools.ads.google import delete_campaign as google_delete_campaign
from tools.ads.google import copy_campaign as google_copy_campaign
from tools.ads.google import list_budgets as google_list_budgets
from tools.ads.google import update_budget as google_update_budget
from tools.ads.google import create_sitelink_extensions as google_create_sitelink_extensions
from tools.ads.google import create_callout_extensions as google_create_callout_extensions
from tools.ads.google import extended as google_extended
from tools.ads.google import remove_campaign_criterion as google_remove_campaign_criterion
from tools.ads.google import update_adgroup as google_update_adgroup
from tools.ads.google import update_campaign as google_update_campaign
from tools.ads.google import update_campaign_geo_target as google_update_campaign_geo_target
from tools.ads.meta import create_ad as meta_create_ad
from tools.ads.meta import create_creative as meta_create_creative
from tools.ads.meta import publish as meta_publish
from tools.ads.meta import search_interests as meta_search_interests
from tools.ads.meta import get_interest_suggestions as meta_get_interest_suggestions
from tools.ads.meta import estimate_audience_size as meta_estimate_audience_size
from tools.ads.meta import search_behaviors as meta_search_behaviors
from tools.ads.meta import search_demographics as meta_search_demographics
from tools.ads.meta import search_geo_locations as meta_search_geo_locations
from tools.ads.meta import resolve_geo_targeting as meta_resolve_geo_targeting
from tools.ads.meta import create_budget_schedule as meta_create_budget_schedule
from tools.ads.meta import duplicate_campaign as meta_duplicate_campaign
from tools.ads.meta import duplicate_adset as meta_duplicate_adset
from tools.ads.meta import duplicate_ad as meta_duplicate_ad
from tools.ads.meta import duplicate_creative as meta_duplicate_creative
from tools.ads.reporting import google_account_summary
from tools.ads.reporting import google_ad_groups
from tools.ads.reporting import google_ads_report
from tools.ads.reporting import google_gaql
from tools.ads.reporting import google_keywords
from tools.ads.reporting import google_optimization_hints
from tools.ads.reporting import google_performance
from tools.ads.reporting import google_search_terms
from tools.ads.reporting import meta_insights

_META_REPORTING_OPS = {
    'campaigns': 'meta_list_campaigns',
    'ad_sets': 'meta_list_adsets',
    'ads': 'meta_list_ads',
    'insights': 'meta_report_insights',
}

_GOOGLE_REPORTING_OPS = {
    'performance': 'google_report_performance',
    'ad_groups': 'google_report_ad_groups',
    'keywords': 'google_report_keywords',
    'ads': 'google_report_ads',
    'search_terms': 'google_report_search_terms',
    'account_summary': 'google_report_account_summary',
    'gaql': 'google_report_gaql',
}

_RUNNERS: Dict[str, Callable[[Dict[str, Any]], Dict[str, Any]]] = {
    'meta_get_ad_accounts': meta_get_accounts.run,
    'meta_get_account': meta_get_account.run,
    'meta_search_ads_library': meta_search_ads_library.run,
    'meta_list_campaigns': meta_list_campaigns.run,
    'meta_get_campaign': meta_get_campaign.run,
    'meta_list_adsets': meta_list_adsets.run,
    'meta_get_adset': meta_get_adset.run,
    'meta_list_ads': meta_list_ads.run,
    'meta_get_ad': meta_get_ad.run,
    'meta_get_creative': meta_get_creative.run,
    'meta_get_ad_creatives': meta_get_ad_creatives.run,
    'meta_update_campaign': meta_update_campaign.run,
    'meta_update_adset': meta_update_adset.run,
    'meta_update_ad': meta_update_ad.run,
    'meta_update_creative': meta_update_creative.run,
    'meta_create_campaign': meta_create_campaign.run,
    'meta_create_adset': meta_create_adset.run,
    'meta_create_creative': meta_create_creative.run,
    'meta_create_ad': meta_create_ad.run,
    'meta_upload_ad_image': meta_upload_ad_image.run,
    'meta_upload_ad_video': meta_upload_ad_video.run,
    'meta_get_ad_image': meta_get_ad_image.run,
    'meta_get_ad_video': meta_get_ad_video.run,
    'meta_compute_image_crops': meta_compute_image_crops.run,
    'meta_get_account_pages': meta_get_account_pages.run,
    'meta_list_ad_pixels': meta_list_ad_pixels.run,
    'meta_get_ad_pixel': meta_get_ad_pixel.run,
    'meta_create_ad_pixel': meta_create_ad_pixel.run,
    'meta_update_ad_pixel': meta_update_ad_pixel.run,
    'meta_search_pages_by_name': meta_search_pages_by_name.run,
    'meta_publish_campaign': meta_publish.run,
    'meta_search_interests': meta_search_interests.run,
    'meta_generate_ad_copy': ads_marketing_intel.run_meta_generate_ad_copy,
    'meta_generate_audience_queries': ads_marketing_intel.run_meta_generate_audience_queries,
    'meta_get_interest_suggestions': meta_get_interest_suggestions.run,
    'meta_estimate_audience_size': meta_estimate_audience_size.run,
    'meta_search_behaviors': meta_search_behaviors.run,
    'meta_search_demographics': meta_search_demographics.run,
    'meta_search_geo_locations': meta_search_geo_locations.run,
    'meta_resolve_geo_targeting': meta_resolve_geo_targeting.run,
    'meta_create_budget_schedule': meta_create_budget_schedule.run,
    'meta_duplicate_campaign': meta_duplicate_campaign.run,
    'meta_duplicate_adset': meta_duplicate_adset.run,
    'meta_duplicate_ad': meta_duplicate_ad.run,
    'meta_duplicate_creative': meta_duplicate_creative.run,
    'google_get_ad_accounts': google_get_accounts.run,
    'google_get_account': google_get_account.run,
    'google_list_campaigns': google_list_campaigns.run,
    'google_get_campaign': google_get_campaign.run,
    'google_list_ad_groups': google_list_ad_groups.run,
    'google_publish_campaign': google_publish.run,
    'google_publish_search_campaign': google_publish_tools.run_publish_search,
    'google_publish_display_campaign': google_publish_tools.run_publish_display,
    'google_publish_video_campaign': google_publish_tools.run_publish_video,
    'google_publish_shopping_campaign': google_publish_tools.run_publish_shopping,
    'google_publish_performance_max_campaign': google_publish_tools.run_publish_performance_max,
    'google_publish_app_campaign': google_publish_tools.run_publish_app,
    'google_publish_local_campaign': google_publish_tools.run_publish_local,
    'google_search_geo_locations': google_publish_tools.run_search_geo_locations,
    'google_resolve_geo_targeting': google_resolve_geo_targeting.run,
    'google_generate_keyword_ideas': google_publish_tools.run_generate_keyword_ideas,
    'google_generate_search_keywords': ads_marketing_intel.run_google_generate_search_keywords,
    'google_generate_rsa_copy': ads_marketing_intel.run_google_generate_rsa_copy,
    'google_suggest_keywords': ads_marketing_intel.run_google_suggest_keywords,
    'google_assess_promotion_context': ads_marketing_intel.run_google_assess_promotion_context,
    'google_generate_search_marketing_bundle': ads_marketing_intel.run_google_generate_search_marketing_bundle,
    'analyze_competitive_landscape': ads_marketing_intel.run_competitive_analysis,
    'google_add_language_targeting': google_publish_tools.run_add_language_targeting,
    'google_list_merchant_centers': google_publish_tools.run_list_merchant_centers,
    'google_pause_campaign': google_pause_campaign.run,
    'google_resume_campaign': google_resume_campaign.run,
    'google_delete_campaign': google_delete_campaign.run,
    'google_copy_campaign': google_copy_campaign.run,
    'google_list_budgets': google_list_budgets.run,
    'google_update_budget': google_update_budget.run,
    'google_create_sitelink_extensions': google_create_sitelink_extensions.run,
    'google_create_callout_extensions': google_create_callout_extensions.run,
    'google_get_account_hierarchy': google_extended.run_get_account_hierarchy,
    'google_get_ad_group': google_extended.run_get_ad_group,
    'google_update_adgroup_full': google_extended.run_update_adgroup_full,
    'google_list_keywords': google_extended.run_list_keywords,
    'google_update_keyword_bid': google_extended.run_update_keyword_bid,
    'google_pause_keyword': google_extended.run_pause_keyword,
    'google_enable_keyword': google_extended.run_enable_keyword,
    'google_delete_keyword': google_extended.run_delete_keyword,
    'google_list_ads_read': google_extended.run_list_ads_read,
    'google_pause_ad': google_extended.run_pause_ad,
    'google_enable_ad': google_extended.run_enable_ad,
    'google_delete_ad': google_extended.run_delete_ad,
    'google_create_structured_snippet_extensions': google_extended.run_create_structured_snippet_extensions,
    'google_create_call_extensions': google_extended.run_create_call_extensions,
    'google_list_extensions': google_extended.run_list_extensions,
    'google_delete_extension': google_extended.run_delete_extension,
    'google_upload_image_asset': google_extended.run_upload_image_asset,
    'google_upload_text_asset': google_extended.run_upload_text_asset,
    'google_list_assets': google_extended.run_list_assets,
    'google_suggest_negative_keywords': google_extended.run_suggest_negative_keywords,
    'google_get_location_performance': google_extended.run_get_location_performance,
    'google_get_device_performance': google_extended.run_get_device_performance,
    'google_list_bidding_strategies': google_extended.run_list_bidding_strategies,
    'google_get_recommendations': google_extended.run_get_recommendations,
    'google_apply_recommendation': google_extended.run_apply_recommendation,
    'google_get_change_history': google_extended.run_get_change_history,
    'google_create_ad_schedule': google_extended.run_create_ad_schedule,
    'google_create_expanded_text_ad': google_extended.run_create_expanded_text_ad,
    'google_create_custom_audience': google_extended.run_create_custom_audience,
    'google_add_audience_targeting': google_extended.run_add_audience_targeting,
    'google_list_audiences': google_extended.run_list_audiences,
    'google_set_bid_adjustments': google_extended.run_set_bid_adjustments,
    'google_optimize_geographic_targeting': google_extended.run_optimize_geographic_targeting,
    'google_create_budget': google_create_budget.run,
    'google_create_search_campaign': google_create_search_campaign.run,
    'google_create_typed_campaign': google_create_typed_campaign.run,
    'google_create_campaign_with_budget': google_create_campaign_with_budget.run,
    'google_create_campaign': google_create_campaign.run,
    'google_update_campaign': google_update_campaign.run,
    'google_update_campaign_geo_target': google_update_campaign_geo_target.run,
    'google_create_geo_targeting': google_create_geo_targeting.run,
    'google_exclude_geo_targets': google_exclude_geo_targets.run,
    'google_add_negative_keywords': google_add_negative_keywords.run,
    'google_remove_campaign_criterion': google_remove_campaign_criterion.run,
    'google_create_adgroup': google_create_adgroup.run,
    'google_update_adgroup': google_update_adgroup.run,
    'google_add_keywords': google_add_keywords.run,
    'google_create_ad': google_create_ad.run,
    'meta_report_insights': meta_insights.run,
    'google_report_performance': google_performance.run,
    'google_report_ad_groups': google_ad_groups.run,
    'google_report_keywords': google_keywords.run,
    'google_report_ads': google_ads_report.run,
    'google_report_search_terms': google_search_terms.run,
    'google_report_account_summary': google_account_summary.run,
    'google_report_gaql': google_gaql.run,
    'google_report_optimization_hints': google_optimization_hints.run,
    'google_docs_gaql': google_docs_gaql.run,
    'google_docs_reporting_views': google_docs_reporting_views.run,
    'google_docs_reporting_fields': google_docs_reporting_fields.run,
}


def reporting_tool_id(platform: str, operation: str) -> str | None:
    op = (operation or '').strip().lower()
    if platform == 'meta':
        return _META_REPORTING_OPS.get(op)
    if platform == 'google':
        return _GOOGLE_REPORTING_OPS.get(op)
    return None


def run_ads_tool(tool_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    fn = _RUNNERS.get(tool_id)
    if not fn:
        raise ValueError(f'Unknown ads tool_id: {tool_id}')
    body = enrich_ads_tool_payload(tool_id, payload or {})
    out = fn(body)
    if isinstance(out, dict) and out.get('ok') is not False and 'ok' not in out:
        return {'ok': True, **out}
    return out
