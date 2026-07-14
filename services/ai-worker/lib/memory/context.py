"""Read-only planner context — no mutations."""

from __future__ import annotations

import json
import logging
from typing import Any

from lib import worker_api

logger = logging.getLogger(__name__)


def build_planner_context(
    workspace_id: str,
    user_message: str,
    attached_media: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Aggregate workspace facts for the planner (READ-ONLY)."""
    social_accounts: list[dict[str, Any]] = []
    ads_accounts: list[dict[str, str]] = []
    default_account_ids: list[str] = []
    if worker_api.configured():
        try:
            social_accounts = worker_api.list_accounts_authorized(
                workspace_id=str(workspace_id),
                kind='social',
            )
        except Exception as exc:
            logger.warning('planner context social accounts: %s', exc)
        try:
            ads_accounts = worker_api.list_accounts_authorized(
                workspace_id=str(workspace_id),
                kind='ads',
            )
            if not ads_accounts:
                logger.warning(
                    'planner context: zero ads accounts for workspace_id=%s (check Accounts UI vs worker list)',
                    workspace_id,
                )
        except Exception as exc:
            logger.warning('planner context ads accounts: %s', exc)
        try:
            settings = worker_api.get_workspace_settings(str(workspace_id))
            default_account_ids = [str(x) for x in (settings.get('default_accounts') or [])]
        except Exception as exc:
            logger.warning('planner context workspace settings: %s', exc)
    else:
        logger.warning('planner context: WORKER_API_SECRET not configured — ads_accounts empty')

    default_set = set(default_account_ids)
    social_rows = [
        {
            'id': a.get('id'),
            'provider': a.get('provider'),
            'name': a.get('name'),
            'username': a.get('username'),
            'is_default_publish': str(a.get('id')) in default_set,
        }
        for a in social_accounts[:20]
    ]
    default_publish_accounts = [row for row in social_rows if row.get('is_default_publish')]

    providers = sorted(
        {a.get('provider') or '' for a in social_accounts + ads_accounts if a.get('provider')},
    )
    return {
        'workspace_id': workspace_id,
        'connected_providers': providers,
        'social_account_count': len(social_accounts),
        'ads_account_count': len(ads_accounts),
        'default_publish_account_ids': default_account_ids,
        'default_publish_accounts': default_publish_accounts,
        'social_accounts': social_rows,
        'ads_accounts': [
            {
                'id': a.get('id'),
                'account_id': a.get('id'),
                'provider': a.get('provider'),
                'name': a.get('name'),
                'username': a.get('username'),
                'authorized': a.get('authorized'),
                'ad_account_id': a.get('ad_account_id'),
            }
            for a in ads_accounts[:20]
        ],
        'accounts_preview': social_rows,
        'user_message': user_message,
        'attached_media': list(attached_media or []),
    }


def format_context_block(ctx: dict[str, Any]) -> str:
    return json.dumps(ctx, indent=2, default=str)
