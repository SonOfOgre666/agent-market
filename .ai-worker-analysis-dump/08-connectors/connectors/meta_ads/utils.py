"""Meta Ads connector helpers."""

from __future__ import annotations

from typing import Any, Optional


def ensure_act_prefix(account_id: str) -> str:
    s = str(account_id or '').strip()
    if not s:
        return s
    if s.startswith('act_'):
        return s
    return f'act_{s.lstrip("act_")}'


def normalize_act_id(ad_account_id: Optional[str], provider_id: Optional[str] = None) -> Optional[str]:
    raw = ad_account_id or (f'act_{provider_id}' if provider_id else None)
    if not raw:
        return None
    return ensure_act_prefix(str(raw))


def map_campaign_status(status: Optional[str]) -> str:
    if not status:
        return 'UNKNOWN'
    mapping = {
        'ACTIVE': 'ACTIVE',
        'PAUSED': 'PAUSED',
        'ARCHIVED': 'ARCHIVED',
        'DELETED': 'DELETED',
    }
    return mapping.get(str(status).upper(), str(status).upper())


def ad_account_status_label(status: Any) -> str:
    try:
        n = int(status)
    except (TypeError, ValueError):
        return f'Status {status}'
    labels = {
        1: 'Active',
        2: 'Disabled',
        3: 'Unsettled',
        7: 'Pending risk review',
        9: 'Pending settlement',
        100: 'Pending closure',
        101: 'Closed',
    }
    return labels.get(n, f'Status {status}')
