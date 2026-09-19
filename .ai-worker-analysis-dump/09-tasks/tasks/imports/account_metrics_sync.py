"""Agent-path sync for import_account_metrics — live refresh + DB snapshot return.

Celery ``tasks.imports.import_account`` stays fire-and-forget for the scheduler.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from bson import ObjectId
from bson.errors import InvalidId

from connectors import _ig_analytics as ig_analytics
from connectors import facebook as facebook_connector
from connectors import twitter as twitter_connector
from db import get_redis
from lib import worker_api

logger = logging.getLogger(__name__)

IG_PROVIDERS = frozenset({'instagram', 'instagram_login'})
FB_INSIGHT_TYPES = {
    'page_post_engagements': 1,
    'page_posts_impressions': 2,
}


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _since_days(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=max(1, days))).date().isoformat()


def _fb_cfg_for(account: dict) -> dict:
    wid = account.get('workspace_id')
    wid_str = str(wid) if wid is not None else None
    try:
        return dict(worker_api.get_service_decrypted('facebook', wid_str) or {})
    except Exception:
        return {}


def _token(account: dict) -> str | None:
    at = account.get('access_token') or {}
    tok = at.get('token')
    return str(tok) if tok else None


def _sync_status(*, ok: bool, error: str | None = None, **extra: Any) -> dict[str, Any]:
    out: dict[str, Any] = {'ok': bool(ok)}
    if error:
        out['error'] = str(error)
    out.update(extra)
    return out


def sync_followers(account: dict, account_id: str) -> dict[str, Any]:
    """Best-effort live follower fetch + audience upsert. Never raises."""
    provider = str(account.get('provider') or '')
    r = get_redis()

    if provider == 'facebook':
        rate_key = f'agentmarket:ratelimit:facebook:{account_id}'
        if r.get(rate_key):
            return _sync_status(ok=False, error='rate_limited', rate_limited=True)
        token = _token(account)
        pid = account.get('provider_id')
        if not token or not pid:
            return _sync_status(ok=False, error='missing_token_or_provider_id')
        result = facebook_connector.fetch_page_follower_counts(token, str(pid), timeout=45.0)
        if result.get('ok'):
            data = result.get('data') or {}
            total = data.get('followers_count')
            if total is None:
                total = data.get('fan_count') or 0
            worker_api.upsert_audience(account_id, _today(), int(total))
            return _sync_status(ok=True, followers_count=int(total))
        if result.get('rate_limited'):
            r.setex(rate_key, 3600, '1')
            return _sync_status(ok=False, error='rate_limited', rate_limited=True)
        if result.get('unauthorized'):
            try:
                worker_api.patch_account_deauthorized(account_id)
            except Exception:
                pass
            return _sync_status(ok=False, error='unauthorized', unauthorized=True)
        return _sync_status(ok=False, error=str(result.get('error') or 'facebook_followers_failed'))

    if provider in IG_PROVIDERS:
        rate_key = f'agentmarket:ratelimit:instagram:{account_id}'
        if r.get(rate_key):
            return _sync_status(ok=False, error='rate_limited', rate_limited=True)
        token = _token(account)
        pid = account.get('provider_id')
        if not token or not pid:
            return _sync_status(ok=False, error='missing_token_or_provider_id')
        fb_cfg = _fb_cfg_for(account) if provider == 'instagram' else None
        result = ig_analytics.fetch_user_followers_count(
            token, str(pid), provider=provider, fb_cfg=fb_cfg, timeout=45.0,
        )
        if result.get('ok'):
            total = int(result.get('followers_count') or 0)
            worker_api.upsert_audience(account_id, _today(), total)
            return _sync_status(ok=True, followers_count=total)
        if result.get('rate_limited'):
            r.setex(rate_key, 3600, '1')
            return _sync_status(ok=False, error='rate_limited', rate_limited=True)
        if result.get('unauthorized'):
            try:
                worker_api.patch_account_deauthorized(account_id)
            except Exception:
                pass
            return _sync_status(ok=False, error='unauthorized', unauthorized=True)
        if result.get('forbidden'):
            return _sync_status(ok=False, error='forbidden')
        return _sync_status(ok=False, error=str(result.get('error') or 'instagram_followers_failed'))

    if provider == 'twitter':
        rate_key = f'agentmarket:ratelimit:twitter:{account_id}'
        if r.get(rate_key):
            return _sync_status(ok=False, error='rate_limited', rate_limited=True)
        at = account.get('access_token') or {}
        token, secret = at.get('token'), at.get('secret')
        if not token:
            return _sync_status(ok=False, error='missing_token')
        wid = account.get('workspace_id')
        wid_str = str(wid) if wid is not None else None
        try:
            cfg = worker_api.get_service_decrypted('twitter', wid_str) or {}
        except Exception:
            cfg = {}
        if not cfg.get('client_id') or not cfg.get('client_secret'):
            return _sync_status(ok=False, error='missing_twitter_app_credentials')
        read = twitter_connector.fetch_authenticated_user_followers(
            str(cfg.get('client_id')),
            str(cfg.get('client_secret')),
            str(token),
            str(secret or ''),
        )
        if read.ok:
            total = int(read.followers_count)
            worker_api.upsert_audience(account_id, _today(), total)
            return _sync_status(ok=True, followers_count=total)
        if read.rate_limited:
            r.setex(rate_key, 900, '1')
            return _sync_status(ok=False, error='rate_limited', rate_limited=True)
        if read.unauthorized:
            try:
                worker_api.patch_account_deauthorized(account_id)
            except Exception:
                pass
            return _sync_status(ok=False, error='unauthorized', unauthorized=True)
        return _sync_status(ok=False, error='twitter_followers_failed')

    return _sync_status(ok=False, error=f'unsupported_provider:{provider}')


def sync_insights(account: dict, account_id: str, *, days: int = 30) -> dict[str, Any]:
    """Best-effort insights/metrics refresh. Never raises."""
    provider = str(account.get('provider') or '')
    r = get_redis()
    since = _since_days(days)
    until = _today()

    if provider == 'facebook':
        rate_key = f'agentmarket:ratelimit:facebook:{account_id}'
        if r.get(rate_key):
            return _sync_status(ok=False, error='rate_limited', rate_limited=True)
        token = _token(account)
        pid = account.get('provider_id')
        if not token or not pid:
            return _sync_status(ok=False, error='missing_token_or_provider_id')
        result = facebook_connector.fetch_page_insights_day_series(
            token, str(pid), since=since, until=until, timeout=90.0,
        )
        if result.get('ok'):
            insights = result.get('insights') or []
            n = 0
            for insight in insights:
                name = insight.get('name')
                itype = FB_INSIGHT_TYPES.get(name)
                if not itype:
                    continue
                for item in insight.get('values') or []:
                    end_time = item.get('end_time') or ''
                    date = end_time.split('T')[0] if end_time else until
                    val = item.get('value')
                    if val is None:
                        val = 0
                    worker_api.upsert_facebook_insight(account_id, itype, val, date)
                    n += 1
            return _sync_status(ok=True, rows=n)
        if result.get('rate_limited'):
            r.setex(rate_key, 3600, '1')
            return _sync_status(ok=False, error='rate_limited', rate_limited=True)
        if result.get('unauthorized'):
            try:
                worker_api.patch_account_deauthorized(account_id)
            except Exception:
                pass
            return _sync_status(ok=False, error='unauthorized', unauthorized=True)
        return _sync_status(ok=False, error=str(result.get('error') or 'facebook_insights_failed'))

    if provider in IG_PROVIDERS:
        rate_key = f'agentmarket:ratelimit:instagram:insights:{account_id}'
        if r.get(rate_key):
            return _sync_status(ok=False, error='rate_limited', rate_limited=True)
        token = _token(account)
        pid = account.get('provider_id')
        if not token or not pid:
            return _sync_status(ok=False, error='missing_token_or_provider_id')
        fb_cfg = _fb_cfg_for(account) if provider == 'instagram' else None
        result = ig_analytics.fetch_account_insights_day_series(
            token,
            str(pid),
            provider=provider,
            since=since,
            until=until,
            fb_cfg=fb_cfg,
        )
        if result.get('ok'):
            rows = result.get('rows') or []
            items = []
            for row in rows:
                day = row.get('date')
                if not day:
                    continue
                data = {k: v for k, v in row.items() if k != 'date'}
                if data:
                    items.append({'account_id': account_id, 'date': day, 'data': data, 'merge': True})
            if items:
                worker_api.bulk_upsert_metrics(items)
            return _sync_status(ok=True, rows=len(items))
        if result.get('rate_limited'):
            r.setex(rate_key, 3600, '1')
            return _sync_status(ok=False, error='rate_limited', rate_limited=True)
        if result.get('unauthorized'):
            try:
                worker_api.patch_account_deauthorized(account_id)
            except Exception:
                pass
            return _sync_status(ok=False, error='unauthorized', unauthorized=True)
        if result.get('forbidden'):
            return _sync_status(ok=False, error='missing_insights_scope')
        return _sync_status(ok=False, error=str(result.get('error') or 'instagram_insights_failed'))

    return _sync_status(ok=False, error='insights_not_supported', skipped=True)


def _snapshot_has_data(snapshot: dict[str, Any] | None) -> bool:
    if not snapshot:
        return False
    if snapshot.get('followers_count') is not None:
        return True
    totals = snapshot.get('metrics_totals') or {}
    if any(v is not None and v != 0 for v in totals.values()):
        return True
    fb = snapshot.get('facebook_insight_totals') or {}
    if any(v is not None and v != 0 for v in fb.values()):
        return True
    return False


def run_import_account_metrics(body: dict[str, Any] | None = None) -> dict[str, Any]:
    """
    Agent entry: try live sync → always read DB snapshot → return answerable payload.
    """
    body = body or {}
    account_id = str(body.get('account_id') or '').strip()
    if not account_id:
        raise ValueError('import_account_metrics requires account_id')
    try:
        ObjectId(account_id)
    except InvalidId as exc:
        raise ValueError('import_account_metrics requires a valid account_id') from exc

    if not worker_api.configured():
        return {
            'ok': False,
            'account_id': account_id,
            'sync_ok': False,
            'stale': False,
            'error': 'WORKER_API_SECRET not configured',
            'available_fields': [],
        }

    try:
        account = worker_api.get_account_worker_context(account_id)
    except Exception as exc:
        return {
            'ok': False,
            'account_id': account_id,
            'sync_ok': False,
            'stale': False,
            'error': f'account_not_found:{exc}',
            'available_fields': [],
        }

    if not account:
        return {
            'ok': False,
            'account_id': account_id,
            'sync_ok': False,
            'stale': False,
            'error': 'account_not_found',
            'available_fields': [],
        }

    provider = str(account.get('provider') or '')
    name = account.get('name') or ''
    username = account.get('username') or ''
    sync_errors: list[str] = []
    followers_sync = _sync_status(ok=False, error='not_attempted')
    insights_sync = _sync_status(ok=False, error='not_attempted')

    if account.get('authorized') is False:
        sync_errors.append('account_unauthorized')
    else:
        try:
            followers_sync = sync_followers(account, account_id)
            if not followers_sync.get('ok') and followers_sync.get('error'):
                sync_errors.append(f"followers:{followers_sync['error']}")
        except Exception as exc:
            logger.warning('[import_account_metrics] followers sync failed %s: %s', account_id, exc)
            followers_sync = _sync_status(ok=False, error=str(exc))
            sync_errors.append(f'followers:{exc}')

        try:
            insights_sync = sync_insights(account, account_id, days=30)
            if (
                not insights_sync.get('ok')
                and not insights_sync.get('skipped')
                and insights_sync.get('error')
            ):
                sync_errors.append(f"insights:{insights_sync['error']}")
        except Exception as exc:
            logger.warning('[import_account_metrics] insights sync failed %s: %s', account_id, exc)
            insights_sync = _sync_status(ok=False, error=str(exc))
            sync_errors.append(f'insights:{exc}')

    sync_ok = bool(followers_sync.get('ok') or insights_sync.get('ok'))

    snapshot: dict[str, Any] = {}
    try:
        snapshot = worker_api.get_account_metrics_snapshot(account_id, days=30) or {}
    except Exception as exc:
        logger.warning('[import_account_metrics] snapshot read failed %s: %s', account_id, exc)
        sync_errors.append(f'snapshot:{exc}')

    has_data = _snapshot_has_data(snapshot)
    stale = bool(has_data and not sync_ok)

    available: list[str] = []
    followers_count = snapshot.get('followers_count')
    if followers_count is None and followers_sync.get('ok'):
        followers_count = followers_sync.get('followers_count')
    if followers_count is not None:
        available.append('followers_count')

    metrics_totals = snapshot.get('metrics_totals') or {}
    fb_totals = snapshot.get('facebook_insight_totals') or {}
    for key, val in {**metrics_totals, **fb_totals}.items():
        if val is not None:
            available.append(str(key))

    reconnect_hint = any(
        'unauthorized' in e or e.endswith(':forbidden') or 'missing_insights_scope' in e
        for e in sync_errors
    )

    return {
        'ok': has_data or sync_ok,
        'account_id': account_id,
        'provider': provider,
        'name': name,
        'username': username,
        'sync_ok': sync_ok,
        'stale': stale,
        'followers_count': followers_count,
        'followers_as_of': snapshot.get('followers_as_of'),
        'metrics_totals': metrics_totals,
        'facebook_insight_totals': fb_totals,
        'period_days': int(snapshot.get('period_days') or 30),
        'available_fields': sorted(set(available)),
        'sync': {
            'followers': followers_sync,
            'insights': insights_sync,
        },
        'sync_errors': sync_errors,
        'reconnect_hint': reconnect_hint,
    }
