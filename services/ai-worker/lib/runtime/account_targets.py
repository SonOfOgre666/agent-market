"""Resolve connected social account IDs for agent publish workflows."""

from __future__ import annotations

from typing import Any

from lib import worker_api

_FACEBOOK_PROVIDERS = frozenset({'facebook', 'facebook_page'})


def _matches_platform(platform: str, account_provider: str) -> bool:
    p = (platform or '').strip().lower()
    prov = (account_provider or '').strip().lower()
    if not p or not prov:
        return False
    if p == 'facebook':
        return prov in _FACEBOOK_PROVIDERS
    if p == 'instagram':
        return prov in ('instagram', 'instagram_login')
    return prov == p


def _post_has_video_media(post: dict[str, Any]) -> bool:
    for version in post.get('versions') or []:
        for block in version.get('content') or []:
            if block.get('type') != 'media':
                continue
            for item in block.get('media') or []:
                mime = str(item.get('mime_type') or '').lower()
                role = str(item.get('role') or '').lower()
                if role == 'video' or mime.startswith('video/'):
                    return True
    return False


def _filter_tiktok_for_image_post(
    account_ids: list[str],
    accounts: list[dict[str, Any]],
    *,
    video_post: bool,
) -> list[str]:
    if video_post:
        return account_ids
    by_id = {str(a.get('id')): a for a in accounts if a.get('id')}
    out: list[str] = []
    for aid in account_ids:
        acc = by_id.get(str(aid))
        if acc and (acc.get('provider') or '') == 'tiktok':
            continue
        out.append(str(aid))
    return out


def resolve_default_account_ids(
    workspace_id: str,
    *,
    platform: str | None = None,
    account_ids: list[str] | None = None,
) -> list[str]:
    """Pick workspace social account(s) when planner omitted account_ids."""
    if account_ids:
        return [str(x) for x in account_ids]

    if not worker_api.configured() or not workspace_id:
        return []

    try:
        accounts = worker_api.list_accounts_authorized(workspace_id=str(workspace_id), kind='social')
    except Exception:
        return []

    if not accounts:
        return []

    if platform:
        matches = [a for a in accounts if _matches_platform(platform, a.get('provider') or '')]
        if len(matches) == 1:
            return [str(matches[0]['id'])]
        if len(matches) > 1:
            return [str(matches[0]['id'])]
        return []

    if len(accounts) == 1:
        return [str(accounts[0]['id'])]

    return []


def enrich_create_draft_payload(payload: dict[str, Any], workspace_id: str | None) -> dict[str, Any]:
    """Draft posts may omit account_ids — pages are chosen at schedule/publish."""
    return dict(payload or {})


def enrich_schedule_publish_payload(payload: dict[str, Any], workspace_id: str | None) -> dict[str, Any]:
    """Ensure schedule_post / publish_post target connected page(s) when possible."""
    out = dict(payload or {})
    if not workspace_id:
        return out

    video_post = False
    post_id = str(out.get('post_id') or '').strip()
    if post_id and worker_api.configured():
        try:
            bundle = worker_api.get_publish_bundle(post_id)
            video_post = _post_has_video_media(bundle.get('post') or {})
        except Exception:
            video_post = False

    accounts: list[dict[str, Any]] = []
    if worker_api.configured():
        try:
            accounts = worker_api.list_accounts_authorized(workspace_id=str(workspace_id), kind='social')
        except Exception:
            accounts = []

    ids = resolve_default_account_ids(
        workspace_id,
        platform=out.get('platform'),
        account_ids=out.get('account_ids'),
    )
    ids = _filter_tiktok_for_image_post(ids, accounts, video_post=video_post)
    if ids:
        out['account_ids'] = ids
    elif out.get('account_ids'):
        out['account_ids'] = _filter_tiktok_for_image_post(
            [str(x) for x in out.get('account_ids') or []],
            accounts,
            video_post=video_post,
        )
    return out
