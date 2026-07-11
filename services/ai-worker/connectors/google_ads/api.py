"""Google Ads client loading — execution only."""

from __future__ import annotations

import re
from typing import Any, Dict

try:
    from google.ads.googleads.client import GoogleAdsClient
    from google.ads.googleads.errors import GoogleAdsException
except ImportError:  # pragma: no cover
    GoogleAdsClient = None  # type: ignore[misc, assignment]
    GoogleAdsException = Exception  # type: ignore[misc, assignment]


class GoogleAdsLibraryMissing(Exception):
    """Install ``google-ads`` (see services/ai-worker/requirements.txt)."""


def health_check() -> bool:
    return GoogleAdsClient is not None


def digits_customer_id(raw: Any) -> str:
    return re.sub(r'\D', '', str(raw or ''))


def load_client(gcfg: Dict[str, Any]):
    if GoogleAdsClient is None:
        raise GoogleAdsLibraryMissing()
    return GoogleAdsClient.load_from_dict(gcfg)


def format_google_ads_exception(exc: BaseException) -> str:
    """Flatten GoogleAdsException.failure.errors for UI / publish_errors."""
    if GoogleAdsException is None or not isinstance(exc, GoogleAdsException):
        return str(exc)
    failure = getattr(exc, 'failure', None)
    errors = list(getattr(failure, 'errors', []) or [])
    parts: list[str] = []
    for err in errors:
        msg = getattr(err, 'message', None)
        if msg is not None:
            parts.append(str(msg))
            continue
        parts.append(str(err))
    if parts:
        return '; '.join(parts)
    return str(exc)
