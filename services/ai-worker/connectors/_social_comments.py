"""Route comment fetch/reply to the correct provider connector."""

from __future__ import annotations

from typing import Any, Dict

from connectors import _meta_comments
from connectors import linkedin as linkedin_connector
from connectors import twitter as twitter_connector

_META_PROVIDERS = frozenset({'facebook', 'facebook_page', 'instagram', 'instagram_login'})


def fetch_comments(
    *,
    provider: str,
    provider_post_id: str,
    account: dict,
    fb_cfg: Dict[str, Any] | None = None,
    tw_cfg: Dict[str, Any] | None = None,
    li_cfg: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    prov = str(provider or '').lower()
    if prov in _META_PROVIDERS:
        token = (account.get('access_token') or {}).get('token')
        return _meta_comments.fetch_comments(
            provider_post_id=provider_post_id,
            access_token=token or '',
            provider=prov,
            fb_cfg=fb_cfg or {},
        )
    if prov == 'twitter':
        at = account.get('access_token') or {}
        return twitter_connector.fetch_comments(
            client_id=(tw_cfg or {}).get('client_id') or '',
            client_secret=(tw_cfg or {}).get('client_secret') or '',
            access_token=at.get('token') or '',
            access_token_secret=at.get('secret') or '',
            provider_post_id=provider_post_id,
        )
    if prov == 'linkedin':
        token = (account.get('access_token') or {}).get('token')
        return linkedin_connector.fetch_comments(
            access_token=token or '',
            provider_post_id=provider_post_id,
            account=account,
        )
    return {'ok': False, 'error': f'Comment sync not supported for provider: {prov}', 'comments': []}


def reply_to_comment(
    *,
    provider: str,
    provider_comment_id: str,
    message: str,
    account: dict,
    fb_cfg: Dict[str, Any] | None = None,
    tw_cfg: Dict[str, Any] | None = None,
    li_cfg: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    prov = str(provider or '').lower()
    if prov in _META_PROVIDERS:
        token = (account.get('access_token') or {}).get('token')
        return _meta_comments.reply_to_comment(
            provider_comment_id=provider_comment_id,
            message=message,
            access_token=token or '',
            provider=prov,
            fb_cfg=fb_cfg or {},
        )
    if prov == 'twitter':
        at = account.get('access_token') or {}
        return twitter_connector.reply_to_comment(
            client_id=(tw_cfg or {}).get('client_id') or '',
            client_secret=(tw_cfg or {}).get('client_secret') or '',
            access_token=at.get('token') or '',
            access_token_secret=at.get('secret') or '',
            provider_comment_id=provider_comment_id,
            message=message,
        )
    if prov == 'linkedin':
        token = (account.get('access_token') or {}).get('token')
        return linkedin_connector.reply_to_comment(
            access_token=token or '',
            provider_comment_id=provider_comment_id,
            message=message,
            account=account,
        )
    return {'ok': False, 'error': f'Comment reply not supported for provider: {prov}'}
