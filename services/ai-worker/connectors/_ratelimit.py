"""Redis-backed rate limit helpers for social connectors (not Mongo)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional


def rate_ttl(r, provider: str, account_id: str) -> Optional[int]:
    k1 = f'agentmarket:ratelimit:{provider}:{account_id}'
    k2 = f'agentmarket:ratelimit:{provider}:app'
    t1 = int(r.ttl(k1) or -2)
    t2 = int(r.ttl(k2) or -2)
    mx = max(t1, t2)
    return mx if mx > 0 else None


def store_rate(r, provider: str, account_id: str, seconds: int, *, app_level: bool = False) -> None:
    key = f'agentmarket:ratelimit:{provider}:app' if app_level else f'agentmarket:ratelimit:{provider}:{account_id}'
    r.setex(key, max(int(seconds), 60), '1')


def parse_retry_after(headers: Dict[str, Any]) -> int:
    h = {k.lower(): v for k, v in headers.items()} if headers else {}
    meta = h.get('x-app-limit-24hour-reset')
    if meta:
        try:
            ts = int(meta)
            return max(60, ts - int(datetime.now(timezone.utc).timestamp()))
        except (TypeError, ValueError):
            pass
    ra = h.get('retry-after') or h.get('x-rate-limit-reset') or h.get('x-ratelimit-reset')
    if not ra:
        return 900
    try:
        sec = int(ra)
        if sec < 10**10:
            return sec
    except (TypeError, ValueError):
        pass
    try:
        dt = datetime.fromisoformat(str(ra).replace('Z', '+00:00'))
        return max(0, int((dt.timestamp() - datetime.now(timezone.utc).timestamp())))
    except Exception:
        return 900
