"""
Native publish path for ``posts`` collection.

Orchestration only: loads bundle via **apps/api**, routes per provider, persists via ``worker_api``.
Provider I/O lives under ``connectors/`` (Twitter, LinkedIn, Facebook Page, Instagram, Instagram Login, TikTok).
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Dict, List

from bson import ObjectId
from bson.errors import InvalidId

from celery_app import celery_app
from connectors import facebook as facebook_connector
from connectors import instagram as instagram_connector
from connectors import instagram_login as instagram_login_connector
from connectors import linkedin as linkedin_connector
from connectors import tiktok as tiktok_connector
from connectors import twitter as twitter_connector
from connectors._social_content import account_id_str, resolve_version
from connectors.social_types import SocialPublishOutcome
from db import get_redis
from lib import worker_api

logger = logging.getLogger(__name__)


def _emit_account_deauthorized(account_id: str) -> None:
    try:
        worker_api.emit_event('account_unauthorized', {'account_id': str(account_id)})
    except Exception as exc:
        logger.warning('[publish_native] emit_event account_unauthorized failed: %s', exc)


PostStatus_PUBLISHED = 2
PostStatus_FAILED = 3
ScheduleStatus_PROCESSED = 2


_SUPPORTED_PROVIDERS = frozenset(
    {
        'twitter',
        'linkedin',
        'facebook',
        'facebook_page',
        'instagram',
        'instagram_login',
        'tiktok',
    }
)


class NodeFallback(Exception):
    """Mixed or unsupported providers — caller should mark failed."""


def _apply_linkedin_outcome(
    r,
    post_id: str,
    account_id: str,
    outcome: SocialPublishOutcome,
) -> str:
    assert isinstance(outcome, SocialPublishOutcome)
    if outcome.ok:
        worker_api.upsert_post_account(
            post_id,
            account_id,
            provider_post_id=outcome.provider_post_id or '',
            data=outcome.upsert_data or {},
            errors=[],
        )
        return account_id
    if outcome.account_deauthorized:
        worker_api.patch_account_deauthorized(account_id)
        _emit_account_deauthorized(account_id)
    if outcome.rate_limit_seconds is not None:
        raise ValueError(outcome.error or f'Rate limited — retry in {outcome.rate_limit_seconds}s')
    raise RuntimeError(outcome.error or 'LinkedIn publish failed')


def _apply_twitter_outcome(r, post_id: str, account_id: str, outcome: SocialPublishOutcome) -> str:
    assert isinstance(outcome, SocialPublishOutcome)
    if outcome.ok:
        worker_api.upsert_post_account(
            post_id,
            account_id,
            provider_post_id=outcome.provider_post_id or '',
            data=outcome.upsert_data or {},
            errors=[],
        )
        return account_id
    if outcome.account_deauthorized:
        worker_api.patch_account_deauthorized(account_id)
        _emit_account_deauthorized(account_id)
    if outcome.rate_limit_seconds is not None:
        raise ValueError(outcome.error or f'Rate limited — retry in {outcome.rate_limit_seconds}s')
    raise RuntimeError(outcome.error or 'Twitter publish failed')


def _publish_one(
    r,
    post: dict,
    account_id: str,
    accounts: List[dict],
    tw_cfg: dict,
    li_cfg: dict,
    fb_cfg: dict,
) -> str:
    account = next((a for a in accounts if account_id_str(a) == account_id), None)
    if not account:
        raise ValueError('Account not found')
    if not account.get('authorized'):
        raise ValueError('Account not authorized')

    version = resolve_version(post, account_id)
    if not version:
        raise ValueError('No content version found')

    provider = account.get('provider')
    post_id = str(post.get('_id') or post.get('id'))

    if provider == 'twitter':
        outcome = twitter_connector.publish_post(
            r=r,
            post=post,
            account=account,
            version=version,
            tw_cfg=tw_cfg,
        )
        return _apply_twitter_outcome(r, post_id, account_id, outcome)

    if provider == 'linkedin':
        outcome = linkedin_connector.publish_post(
            r=r,
            post=post,
            account=account,
            version=version,
            _li_cfg=li_cfg,
        )
        return _apply_linkedin_outcome(r, post_id, account_id, outcome)

    if provider in ('facebook', 'facebook_page'):
        outcome = facebook_connector.publish_post(account=account, version=version, fb_cfg=fb_cfg)
        return _apply_twitter_outcome(r, post_id, account_id, outcome)

    if provider == 'instagram':
        outcome = instagram_connector.publish_post(account=account, version=version, fb_cfg=fb_cfg)
        return _apply_twitter_outcome(r, post_id, account_id, outcome)

    if provider == 'instagram_login':
        outcome = instagram_login_connector.publish_post(account=account, version=version, _fb_cfg=fb_cfg)
        return _apply_twitter_outcome(r, post_id, account_id, outcome)

    if provider == 'tiktok':
        outcome = tiktok_connector.publish_post(account=account, version=version, _cfg={})
        return _apply_twitter_outcome(r, post_id, account_id, outcome)

    raise NodeFallback()


def run_native_publish_post(post_id: str) -> None:
    if not worker_api.configured():
        logger.error('[publish_native] WORKER_API_SECRET not set — cannot load publish bundle from API')
        return

    r = get_redis()
    try:
        oid = ObjectId(post_id)
    except InvalidId:
        logger.error('[publish_native] invalid post_id=%s', post_id)
        return

    try:
        bundle = worker_api.get_publish_bundle(post_id)
    except Exception as exc:
        if type(exc).__name__ == 'HTTPStatusError':
            logger.error('[publish_native] bundle HTTP error post_id=%s: %s', post_id, exc)
            return
        logger.exception('[publish_native] bundle failed post_id=%s: %s', post_id, exc)
        return

    post = bundle.get('post') or {}
    accounts = bundle.get('accounts') or []
    tw_cfg = bundle.get('twitter_service') or {}
    li_cfg = bundle.get('linkedin_service') or {}
    fb_cfg = bundle.get('facebook_service') or {}

    if not post:
        logger.error('[publish_native] empty post in bundle %s', post_id)
        return

    account_ids = [str(x) for x in (post.get('account_ids') or [])]
    if not account_ids:
        now = datetime.now(timezone.utc).isoformat()
        worker_api.patch_post(
            str(oid),
            {'status': PostStatus_FAILED, 'schedule_status': ScheduleStatus_PROCESSED, 'updated_at': now},
        )
        return

    for aid in account_ids:
        acc = next((a for a in accounts if account_id_str(a) == aid), None)
        if not acc:
            raise NodeFallback()
        p = acc.get('provider')
        if p not in _SUPPORTED_PROVIDERS:
            raise NodeFallback()

    published: List[str] = []
    errors: List[Dict[str, Any]] = []

    try:
        with ThreadPoolExecutor(max_workers=min(8, len(account_ids))) as ex:
            futs = {
                ex.submit(_publish_one, r, post, aid, accounts, tw_cfg, li_cfg, fb_cfg): aid
                for aid in account_ids
            }
            for fut in as_completed(futs):
                aid = futs[fut]
                try:
                    published.append(fut.result())
                except NodeFallback:
                    raise
                except Exception as exc:
                    em = str(exc)
                    logger.error('[publish_native] account=%s err=%s', aid, em)
                    pid = str(post.get('_id') or post.get('id'))
                    worker_api.upsert_post_account(pid, aid, provider_post_id=None, data={}, errors=[em])
                    errors.append({'account_id': aid, 'error': em})
    except NodeFallback:
        raise

    now_iso = datetime.now(timezone.utc).isoformat()
    all_failed = len(published) == 0 and len(errors) > 0
    fields: Dict[str, Any] = {
        'status': PostStatus_FAILED if all_failed else PostStatus_PUBLISHED,
        'schedule_status': ScheduleStatus_PROCESSED,
        'updated_at': now_iso,
    }
    if not all_failed:
        fields['published_at'] = now_iso
    worker_api.patch_post(str(oid), fields)

    pid = str(post.get('_id') or post.get('id'))
    try:
        worker_api.emit_event(
            'post.published' if not all_failed else 'post.failed',
            {'post_id': pid, 'published': published, 'errors': errors},
        )
    except Exception as exc:
        logger.warning('[publish_native] emit_event failed: %s', exc)

    if not all_failed and published:
        try:
            celery_app.send_task('tasks.social.sync_post_comments', args=[pid])
        except Exception as exc:
            logger.warning('[publish_native] comment sync enqueue failed: %s', exc)

    logger.info('[publish_native] post=%s published=%s errors=%s', post_id, len(published), len(errors))
