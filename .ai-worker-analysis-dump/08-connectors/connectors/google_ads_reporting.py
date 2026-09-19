"""Backward-compatible shim — use ``connectors.google_ads.reporting``."""

from connectors.google_ads.reporting import (  # noqa: F401
    preprocess_gaql,
    run_google_ads_reporting,
)

__all__ = ['preprocess_gaql', 'run_google_ads_reporting']
