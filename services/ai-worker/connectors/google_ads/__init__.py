"""Google Ads connector package — platform execution only."""

from .api import (
    GoogleAdsException,
    GoogleAdsLibraryMissing,
    digits_customer_id,
    health_check,
    load_client,
)
from .accounts import fetch_accessible_accounts, fetch_customer_info, list_accessible_customer_ids
from .adgroups import create_ad_group, create_paused_ad_group, list_ad_groups, update_ad_group_status
from .ads import create_responsive_search_ad
from .budgets import create_campaign_budget
from .criteria import (
    create_geo_targeting,
    create_negative_campaign_keywords,
    exclude_geo_targets,
    remove_campaign_criterion,
    resolve_campaign_resource_name,
)
from .keywords import add_keywords_to_ad_group
from .campaigns import (
    create_search_campaign,
    execute_publish_campaign_mutations,
    fetch_campaign_sync_rows,
    get_campaign,
    list_campaigns,
    mutate_create_paused_campaign,
    mutate_update_campaign_status,
    update_campaign_geo_target_type,
    update_campaign_status,
)
from .reporting import preprocess_gaql, run_google_ads_reporting

__all__ = [
    'preprocess_gaql',
    'run_google_ads_reporting',
    'add_keywords_to_ad_group',
    'create_campaign_budget',
    'create_geo_targeting',
    'create_negative_campaign_keywords',
    'create_ad_group',
    'create_paused_ad_group',
    'create_responsive_search_ad',
    'create_search_campaign',
    'exclude_geo_targets',
    'fetch_accessible_accounts',
    'fetch_customer_info',
    'get_campaign',
    'list_accessible_customer_ids',
    'list_ad_groups',
    'list_campaigns',
    'remove_campaign_criterion',
    'resolve_campaign_resource_name',
    'GoogleAdsException',
    'GoogleAdsLibraryMissing',
    'digits_customer_id',
    'execute_publish_campaign_mutations',
    'fetch_campaign_sync_rows',
    'health_check',
    'load_client',
    'mutate_create_paused_campaign',
    'mutate_update_campaign_status',
    'update_ad_group_status',
    'update_campaign_geo_target_type',
    'update_campaign_status',
]
