"""Sync comments from connected platforms into post_comments via API."""

from __future__ import annotations

import logging

from celery_app import celery_app
from connectors import _social_comments
from lib import worker_api

logger = logging.getLogger(__name__)


def _deauthorize_if_needed(result: dict, account_id: str, provider: str = '') -> None:
    if not result.get('oauth_invalid') or not account_id:
        return
    if result.get('ig_comments_unavailable'):
        return
    try:
        worker_api.patch_account_deauthorized(account_id)
    except Exception as exc:
        logger.warning('[sync_post_comments] deauthorize failed account=%s provider=%s: %s', account_id, provider, exc)


@celery_app.task(name='tasks.social.sync_post_comments')
def sync_post_comments(post_id: str):
    if not worker_api.configured():
        logger.warning('[sync_post_comments] WORKER_API_SECRET not set — skipped post_id=%s', post_id)
        return

    try:
        bundle = worker_api.get_comment_sync_bundle(post_id)
    except Exception as exc:
        logger.exception('[sync_post_comments] bundle failed post_id=%s: %s', post_id, exc)
        return

    post = bundle.get('post') or {}
    workspace_id = post.get('workspace_id')
    post_id_str = str(post.get('_id') or post.get('id') or post_id)
    post_context = bundle.get('post_context') or ''
    fb_cfg = bundle.get('facebook_service') or {}
    tw_cfg = bundle.get('twitter_service') or {}
    li_cfg = bundle.get('linkedin_service') or {}
    targets = bundle.get('targets') or []

    if not workspace_id or not targets:
        logger.info('[sync_post_comments] no comment-sync targets post_id=%s', post_id_str)
        return

    synced = 0
    for target in targets:
        account = target.get('account') or {}
        provider = str(target.get('provider') or account.get('provider') or '')
        provider_post_id = str(target.get('provider_post_id') or '')
        account_id = str(target.get('account_id') or account.get('_id') or account.get('id') or '')
        if not provider_post_id or not account_id:
            continue

        result = _social_comments.fetch_comments(
            provider=provider,
            provider_post_id=provider_post_id,
            account=account,
            fb_cfg=fb_cfg,
            tw_cfg=tw_cfg,
            li_cfg=li_cfg,
        )
        if not result.get('ok'):
            _deauthorize_if_needed(result, account_id, provider)
            logger.warning(
                '[sync_post_comments] fetch failed post=%s account=%s provider=%s: %s',
                post_id_str,
                account_id,
                provider,
                result.get('error'),
            )
            continue

        for row in result.get('comments') or []:
            try:
                worker_api.upsert_post_comment({
                    'workspace_id': str(workspace_id),
                    'post_id': post_id_str,
                    'account_id': account_id,
                    'provider': provider,
                    'provider_post_id': provider_post_id,
                    'provider_comment_id': row.get('provider_comment_id'),
                    'comment': row.get('comment'),
                    'author': row.get('author'),
                    'platform_created_at': row.get('platform_created_at'),
                    'post_context': post_context,
                    'reply_supported': True,
                })
                synced += 1
            except Exception as exc:
                logger.warning('[sync_post_comments] upsert failed: %s', exc)

    if synced:
        logger.info('[sync_post_comments] post_id=%s synced=%d', post_id_str, synced)
