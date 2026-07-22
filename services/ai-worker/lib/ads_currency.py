"""Ads budget currency: parse user currency, convert to account currency when needed.

Rules:
- No currency stated → treat amount as account currency (no conversion).
- Currency matches account → no conversion.
- Currency differs → convert to account currency before create.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_SYMBOL_TO_ISO: dict[str, str] = {
    '$': 'USD',
    '€': 'EUR',
    '£': 'GBP',
    '¥': 'JPY',
    'د.م.': 'MAD',
    'dh': 'MAD',
    'mad': 'MAD',
}

_NAME_TO_ISO: dict[str, str] = {
    'usd': 'USD',
    'dollar': 'USD',
    'dollars': 'USD',
    'us dollar': 'USD',
    'us dollars': 'USD',
    'eur': 'EUR',
    'euro': 'EUR',
    'euros': 'EUR',
    'gbp': 'GBP',
    'pound': 'GBP',
    'pounds': 'GBP',
    'mad': 'MAD',
    'dirham': 'MAD',
    'dirhams': 'MAD',
    'moroccan dirham': 'MAD',
    'moroccan dirhams': 'MAD',
    'cad': 'CAD',
    'aud': 'AUD',
    'chf': 'CHF',
    'jpy': 'JPY',
    'cny': 'CNY',
    'sar': 'SAR',
    'aed': 'AED',
    'egp': 'EGP',
    'tnd': 'TND',
    'dzd': 'DZD',
}

# Prefer explicit currency codes / names before bare $ /day patterns.
_BUDGET_PATTERNS: list[tuple[re.Pattern[str], str | None]] = [
    (re.compile(r'(\d+(?:\.\d+)?)\s*(usd|eur|gbp|mad|cad|aud|chf|sar|aed|egp)\s*(?:/|per)?\s*day\b', re.I), 'group2'),
    (re.compile(r'(\d+(?:\.\d+)?)\s*(dollars?|euros?|pounds?|dirhams?)\s*(?:/|per)?\s*day\b', re.I), 'group2'),
    (re.compile(r'(usd|eur|gbp|mad)\s*(\d+(?:\.\d+)?)\s*(?:/|per)?\s*day\b', re.I), 'code_first'),
    (re.compile(r'\$(\d+(?:\.\d+)?)\s*/?\s*day\b', re.I), 'USD'),
    (re.compile(r'€(\d+(?:\.\d+)?)\s*/?\s*day\b', re.I), 'EUR'),
    (re.compile(r'£(\d+(?:\.\d+)?)\s*/?\s*day\b', re.I), 'GBP'),
    (re.compile(r'budget\s*(?:of|:)?\s*\$(\d+(?:\.\d+)?)', re.I), 'USD'),
    (re.compile(r'budget\s*(?:of|:)?\s*(\d+(?:\.\d+)?)\s*(usd|eur|gbp|mad|dollars?|dirhams?)', re.I), 'group2'),
    (re.compile(r'(\d+(?:\.\d+)?)\s*(?:/|per)\s*day\b', re.I), None),
    (re.compile(r'\$(\d+(?:\.\d+)?)\b', re.I), 'USD'),
    (re.compile(r'(\d+(?:\.\d+)?)\s*\$', re.I), 'USD'),
    (re.compile(r'(\d+(?:\.\d+)?)\s*(usd|eur|gbp|mad|dh)\b', re.I), 'group2'),
]


@dataclass(frozen=True)
class BudgetMention:
    amount: float
    currency: str | None = None  # ISO 4217 when user stated a currency


@dataclass(frozen=True)
class FxQuote:
    rate: float
    date: str | None
    source: str
    base: str
    quote: str


@dataclass(frozen=True)
class BudgetConversion:
    amount: float
    account_currency: str
    source_currency: str | None
    converted: bool
    rate: float | None = None
    rate_date: str | None = None
    rate_source: str | None = None


def normalize_currency_code(raw: str | None) -> str | None:
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    if text in _SYMBOL_TO_ISO:
        return _SYMBOL_TO_ISO[text]
    lower = text.lower()
    if lower in _SYMBOL_TO_ISO:
        return _SYMBOL_TO_ISO[lower]
    if lower in _NAME_TO_ISO:
        return _NAME_TO_ISO[lower]
    code = re.sub(r'[^A-Za-z]', '', text).upper()
    if len(code) == 3 and code.isalpha():
        return code
    return None


def extract_budget_mention(prompt: str) -> BudgetMention | None:
    """Parse daily budget amount + optional currency from user text."""
    text = prompt or ''
    for pat, kind in _BUDGET_PATTERNS:
        hit = pat.search(text)
        if not hit:
            continue
        try:
            if kind == 'code_first':
                currency = normalize_currency_code(hit.group(1))
                amount = float(hit.group(2))
            elif kind == 'group2':
                amount = float(hit.group(1))
                currency = normalize_currency_code(hit.group(2))
            elif kind is None:
                amount = float(hit.group(1))
                currency = None
            else:
                amount = float(hit.group(1))
                currency = kind
        except (TypeError, ValueError):
            continue
        if amount >= 1:
            return BudgetMention(amount=amount, currency=currency)
    return None


def extract_daily_budget_amount(prompt: str) -> float | None:
    mention = extract_budget_mention(prompt)
    return mention.amount if mention else None


# Mid-market rates from 84 central banks / official sources (~201 currencies).
# Same class of rate Google shows for “EUR to USD” (no retail markup). No fallbacks.
_FRANKFURTER_RATE_URL = 'https://api.frankfurter.dev/v2/rate/{base}/{quote}'


def fetch_fx_quote(from_currency: str, to_currency: str) -> FxQuote:
    """Fetch one mid-market FX quote (units of quote per 1 base)."""
    src = normalize_currency_code(from_currency)
    dst = normalize_currency_code(to_currency)
    if not src or not dst:
        raise ValueError(f'Invalid currency pair: {from_currency} → {to_currency}')
    if src == dst:
        return FxQuote(rate=1.0, date=None, source='identity', base=src, quote=dst)

    url = _FRANKFURTER_RATE_URL.format(base=src, quote=dst)
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(url)
            if resp.status_code == 404:
                raise ValueError(
                    f'No mid-market rate for {src} → {dst}. '
                    'That currency pair is not published by Frankfurter central-bank feeds.'
                )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        logger.warning('Frankfurter FX fetch failed %s→%s: %s', src, dst, exc)
        raise ValueError(
            f'Could not fetch live mid-market rate for {src} → {dst}: {exc}'
        ) from exc

    if not isinstance(data, dict) or data.get('rate') is None:
        raise ValueError(f'Invalid FX response for {src} → {dst}')
    rate = float(data['rate'])
    if rate <= 0:
        raise ValueError(f'Invalid FX rate for {src} → {dst}: {rate}')
    return FxQuote(
        rate=rate,
        date=str(data.get('date') or '') or None,
        source='frankfurter',
        base=str(data.get('base') or src),
        quote=str(data.get('quote') or dst),
    )


def fetch_fx_rate(from_currency: str, to_currency: str) -> float:
    """Return units of ``to_currency`` per 1 ``from_currency`` (mid-market)."""
    return fetch_fx_quote(from_currency, to_currency).rate


def convert_amount(amount: float, from_currency: str, to_currency: str) -> BudgetConversion:
    src = normalize_currency_code(from_currency)
    dst = normalize_currency_code(to_currency) or 'USD'
    if not src or src == dst:
        return BudgetConversion(
            amount=float(amount),
            account_currency=dst,
            source_currency=src,
            converted=False,
            rate=1.0 if src == dst else None,
            rate_source='identity' if src == dst else None,
        )
    quote = fetch_fx_quote(src, dst)
    converted = float(amount) * quote.rate
    # Keep money readable: 2 decimals for most, whole units for larger amounts.
    if converted >= 100:
        converted = round(converted, 0)
    else:
        converted = round(converted, 2)
    if converted < 1:
        converted = 1.0
    return BudgetConversion(
        amount=converted,
        account_currency=dst,
        source_currency=src,
        converted=True,
        rate=quote.rate,
        rate_date=quote.date,
        rate_source=quote.source,
    )


def resolve_budget_for_account(
    amount: float | int | str | None,
    *,
    source_currency: str | None,
    account_currency: str | None,
) -> BudgetConversion | None:
    """
    Apply product rules for ads budgets.

    - No source currency → amount stays as account-currency units.
    - Source equals account → unchanged.
    - Source differs → FX convert into account currency.
    """
    if amount is None:
        return None
    try:
        value = float(amount)
    except (TypeError, ValueError):
        return None
    if value <= 0:
        return None

    account = normalize_currency_code(account_currency) or 'USD'
    source = normalize_currency_code(source_currency)
    if not source:
        return BudgetConversion(
            amount=value,
            account_currency=account,
            source_currency=None,
            converted=False,
            rate=None,
        )
    return convert_amount(value, source, account)


def budget_fields_from_payload(payload: dict[str, Any]) -> tuple[Any, str | None]:
    """Extract (amount, source_currency) from a tool payload."""
    budget = payload.get('budget') if isinstance(payload.get('budget'), dict) else {}
    amount = (
        payload.get('daily_budget')
        or payload.get('budget_amount')
        or payload.get('amount')
        or budget.get('amount')
    )
    source = (
        payload.get('budget_currency')
        or payload.get('source_currency')
        or payload.get('user_currency')
        or budget.get('source_currency')
        or budget.get('budget_currency')
    )
    account_hint = normalize_currency_code(
        payload.get('account_currency') or budget.get('account_currency')
    )
    # budget.currency is user-stated only when it differs from known account currency.
    if source is None and budget.get('currency'):
        code = normalize_currency_code(str(budget.get('currency')))
        if code and account_hint and code != account_hint:
            source = code
    return amount, normalize_currency_code(str(source) if source else None)


def account_currency_from_payload(payload: dict[str, Any]) -> str | None:
    budget = payload.get('budget') if isinstance(payload.get('budget'), dict) else {}
    return normalize_currency_code(
        payload.get('account_currency')
        or budget.get('account_currency')
        or payload.get('currency')
        or budget.get('account_currency')
    )
