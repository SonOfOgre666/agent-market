"""Meta Ads connector package — platform execution only."""

from .accounts import fetch_me_adaccounts, get_account_info, list_ad_accounts
from .ads_library import search_ads_archive
from .ads import create_ad, get_ad_details, list_ads, update_ad
from .adsets import create_adset, get_adset_details, list_adsets, update_adset
from .campaigns import (
    create_campaign,
    fetch_campaigns_for_ad_account,
    get_campaign_details,
    list_campaigns,
    update_campaign,
)
from .creatives import (
    create_ad_creative,
    create_link_creative,
    get_ad_creatives,
    get_ad_image_urls,
    get_ad_video,
    get_creative_details,
    update_ad_creative,
    upload_ad_image,
    upload_ad_video,
)
from .image_crops import compute_image_crops
from .pages import get_account_pages, search_pages_by_name
from .insights import get_insights
from .reporting import list_ads as reporting_list_ads, run_meta_ads_reporting
from .targeting import default_targeting, resolve_targeting
from .targeting_search import (
    estimate_audience_size,
    get_interest_suggestions,
    search_behaviors,
    search_demographics,
    search_geo_locations,
    search_interests,
)
from .budget_schedules import create_budget_schedule
from .duplication import duplicate_ad, duplicate_adset, duplicate_campaign, duplicate_creative, duplication_enabled
from .creatives import get_ad_image

__all__ = [
    'default_targeting',
    'get_insights',
    'reporting_list_ads',
    'resolve_targeting',
    'run_meta_ads_reporting',
    'create_ad',
    'get_ad_details',
    'list_ads',
    'update_ad',
    'create_adset',
    'get_adset_details',
    'list_adsets',
    'update_adset',
    'create_campaign',
    'create_ad_creative',
    'create_link_creative',
    'get_ad_creatives',
    'get_ad_image_urls',
    'get_ad_video',
    'get_account_pages',
    'get_creative_details',
    'compute_image_crops',
    'search_pages_by_name',
    'update_ad_creative',
    'upload_ad_image',
    'upload_ad_video',
    'fetch_campaigns_for_ad_account',
    'get_campaign_details',
    'list_campaigns',
    'update_campaign',
    'fetch_me_adaccounts',
    'get_account_info',
    'list_ad_accounts',
    'search_ads_archive',
    'search_interests',
    'get_interest_suggestions',
    'estimate_audience_size',
    'search_behaviors',
    'search_demographics',
    'search_geo_locations',
    'create_budget_schedule',
    'duplicate_campaign',
    'duplicate_adset',
    'duplicate_ad',
    'duplicate_creative',
    'duplication_enabled',
    'get_ad_image',
]
