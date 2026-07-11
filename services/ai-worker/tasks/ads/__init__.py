"""Ads execution tasks (Celery)."""

from . import marketing_content  # noqa: F401
from . import fetch_facebook_pages  # noqa: F401
from . import fetch_meta_ad_accounts_bundle  # noqa: F401
from . import execute_ads_tool  # noqa: F401
from . import google_ads_reporting_read  # noqa: F401
from . import meta_ads_reporting_read  # noqa: F401
from . import on_demand_sync  # noqa: F401
from . import publish_campaign  # noqa: F401
from . import update_remote_campaign_status  # noqa: F401
from . import campaign_content  # noqa: F401
from . import workspace_ops  # noqa: F401
