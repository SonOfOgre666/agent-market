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
    social_accounts: list[dict[str, str]] = []
    ads_accounts: list[dict[str, str]] = []
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
    else:
        logger.warning('planner context: WORKER_API_SECRET not configured — ads_accounts empty')

    providers = sorted(
        {a.get('provider') or '' for a in social_accounts + ads_accounts if a.get('provider')},
    )
    return {
        'workspace_id': workspace_id,
        'connected_providers': providers,
        'social_account_count': len(social_accounts),
        'ads_account_count': len(ads_accounts),
        'social_accounts': [
            {
                'id': a.get('id'),
                'provider': a.get('provider'),
                'name': a.get('name'),
                'username': a.get('username'),
            }
            for a in social_accounts[:20]
        ],
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
        'accounts_preview': [
            {
                'id': a.get('id'),
                'provider': a.get('provider'),
                'name': a.get('name'),
                'username': a.get('username'),
            }
            for a in social_accounts[:20]
        ],
        'user_message': user_message,
        'attached_media': list(attached_media or []),
    }


def format_context_block(ctx: dict[str, Any]) -> str:
    return json.dumps(ctx, indent=2, default=str)
