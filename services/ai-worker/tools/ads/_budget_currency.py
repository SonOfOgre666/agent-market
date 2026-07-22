"""Apply FX conversion on ads tool payloads before budget create/update."""

from __future__ import annotations

import logging
from typing import Any

from lib.ads_currency import (
    BudgetConversion,
    account_currency_from_payload,
    budget_fields_from_payload,
    normalize_currency_code,
    resolve_budget_for_account,
)

logger = logging.getLogger(__name__)


def _resolve_google_account_currency(payload: dict[str, Any]) -> str | None:
    code = account_currency_from_payload(payload)
    if code:
        return code
    try:
        from tools.ads.google._config import require_google_config
        from connectors.google_ads.accounts import fetch_customer_info

        gcfg, customer_id = require_google_config(payload)
        info = fetch_customer_info(gcfg, customer_id=customer_id)
        if info.get('ok'):
            return normalize_currency_code(info.get('currency'))
    except Exception as exc:
        logger.warning('could not resolve Google account currency: %s', exc)
    return None


def _resolve_meta_account_currency(payload: dict[str, Any]) -> str | None:
    code = account_currency_from_payload(payload)
    if code:
        return code
    token = (payload.get('access_token') or '').strip()
    account_id = payload.get('ad_account_id') or payload.get('account_id')
    if not token or not account_id:
        return None
    try:
        from connectors.meta_ads.accounts import get_account_info

        info = get_account_info(
            token,
            account_id=str(account_id),
            api_version=str(payload.get('api_version') or 'v22.0'),
        )
        if isinstance(info, dict) and info.get('ok'):
            account = info.get('account') if isinstance(info.get('account'), dict) else info
            return normalize_currency_code(account.get('currency'))
    except Exception as exc:
        logger.warning('could not resolve Meta account currency: %s', exc)
    return None


def convert_payload_budget(
    payload: dict[str, Any],
    *,
    platform: str,
) -> tuple[dict[str, Any], BudgetConversion | None]:
    """
    Return a shallow-copied payload whose budget amount is in account currency.

    Adds ``budget_conversion`` metadata when a conversion (or explicit no-op) is applied.
    """
    body = dict(payload or {})
    amount, source_currency = budget_fields_from_payload(body)
    if amount is None:
        return body, None

    if platform == 'google':
        account_currency = _resolve_google_account_currency(body)
    elif platform == 'meta':
        account_currency = _resolve_meta_account_currency(body)
    else:
        account_currency = account_currency_from_payload(body)

    if not account_currency:
        # Cannot convert safely without account currency — leave amount as-is.
        return body, None

    result = resolve_budget_for_account(
        amount,
        source_currency=source_currency,
        account_currency=account_currency,
    )
    if not result:
        return body, None

    # Write converted amount back into common payload shapes.
    if body.get('daily_budget') is not None:
        body['daily_budget'] = result.amount
    if body.get('budget_amount') is not None:
        body['budget_amount'] = result.amount
    if body.get('amount') is not None and not isinstance(body.get('budget'), dict):
        body['amount'] = result.amount

    budget = dict(body.get('budget') or {}) if isinstance(body.get('budget'), dict) else {}
    if budget or source_currency or result.converted:
        if 'amount' in budget or source_currency or result.converted:
            budget['amount'] = result.amount
        budget['account_currency'] = result.account_currency
        if result.source_currency:
            budget['source_currency'] = result.source_currency
        budget['currency'] = result.account_currency
        body['budget'] = budget

    body['account_currency'] = result.account_currency
    body['budget_conversion'] = {
        'amount': result.amount,
        'account_currency': result.account_currency,
        'source_currency': result.source_currency,
        'converted': result.converted,
        'rate': result.rate,
        'rate_date': result.rate_date,
        'rate_source': result.rate_source,
    }
    return body, result
