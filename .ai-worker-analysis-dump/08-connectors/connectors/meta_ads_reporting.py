"""Backward-compatible shim — use ``connectors.meta_ads.reporting``."""

from connectors.meta_ads.reporting import (  # noqa: F401
    get_insights,
    list_ads,
    run_meta_ads_reporting,
)

__all__ = [
    'get_insights',
    'list_ads',
    'run_meta_ads_reporting',
]
