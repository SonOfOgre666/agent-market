"""Post a reply to a synced comment on the originating platform."""

from __future__ import annotations

import logging

from celery_app import celery_app
from connectors import _social_comments
from lib import worker_api

logger = logging.getLogger(__name__)


@celery_app.task(name='tasks.social.reply_to_comment')
def reply_to_comment(comment_uuid: str):
    if not worker_api.configured():
        logger.warning('[reply_to_comment] WORKER_API_SECRET not set — skipped uuid=%s', comment_uuid)
        return

    try:
        ctx = worker_api.get_post_comment_worker_context(comment_uuid)
    except Exception as exc:
        logger.exception('[reply_to_comment] context failed uuid=%s: %s', comment_uuid, exc)
        return

    record = ctx.get('comment') or {}
    account = ctx.get('account') or {}
    fb_cfg = ctx.get('facebook_service') or {}
    tw_cfg = ctx.get('twitter_service') or {}
    li_cfg = ctx.get('linkedin_service') or {}
    reply = record.get('reply') or {}
    text = str(reply.get('text') or '').strip()
    provider = str(ctx.get('provider') or record.get('provider') or account.get('provider') or '')
    provider_comment_id = str(record.get('provider_comment_id') or '')

    if not text:
        worker_api.apply_post_comment_reply_result(comment_uuid, {
            'ok': False,
            'error': 'Reply text missing',
        })
        return
    if not provider_comment_id or not account:
        worker_api.apply_post_comment_reply_result(comment_uuid, {
            'ok': False,
            'error': 'Missing account or provider_comment_id',
        })
        return

    result = _social_comments.reply_to_comment(
        provider=provider,
        provider_comment_id=provider_comment_id,
        message=text,
        account=account,
        fb_cfg=fb_cfg,
        tw_cfg=tw_cfg,
        li_cfg=li_cfg,
    )

    if result.get('oauth_invalid'):
        account_id = str(record.get('account_id') or account.get('_id') or account.get('id') or '')
        if account_id:
            try:
                worker_api.patch_account_deauthorized(account_id)
            except Exception as exc:
                logger.warning('[reply_to_comment] deauthorize failed account=%s: %s', account_id, exc)

    worker_api.apply_post_comment_reply_result(comment_uuid, {
        'ok': bool(result.get('ok')),
        'provider_reply_id': result.get('provider_reply_id'),
        'error': result.get('error'),
    })
