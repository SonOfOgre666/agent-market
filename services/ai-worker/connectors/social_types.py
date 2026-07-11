"""Shared result types for social execution connectors (no I/O)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass
class SocialPublishOutcome:
    """Return value from ``publish_post`` in social connectors — persistence stays in the task layer."""

    ok: bool
    provider_post_id: Optional[str] = None
    upsert_data: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None
    account_deauthorized: bool = False
    rate_limit_seconds: Optional[int] = None
