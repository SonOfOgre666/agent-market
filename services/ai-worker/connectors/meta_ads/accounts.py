"""Meta Ads account reads — parity with reference_ads/meta_ads/accounts.py (no MCP)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Union

from .api import GraphAPIError, format_graph_error, graph_request
from .utils import ad_account_status_label, ensure_act_prefix

_ZERO_DECIMAL_CURRENCIES = frozenset({
    'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA',
    'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
})

_ACCOUNT_LIST_FIELDS = (
    'id,name,account_id,account_status,amount_spent,balance,currency,age,'
    'business_city,business_country_code'
)

_DEFAULT_ACCOUNT_INFO_FIELDS = (
    'id,name,account_id,account_status,amount_spent,balance,currency,age,'
    'business_city,business_country_code,timezone_name'
)

_EU_DSA_COUNTRIES = frozenset({
    'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'IE', 'DK', 'SE', 'FI', 'NO',
})


def _cents_to_currency(amount: Any, currency: str) -> str:
    try:
        amount_int = int(amount)
    except (TypeError, ValueError):
        return str(amount)
    if str(currency or 'USD').upper() in _ZERO_DECIMAL_CURRENCIES:
        return str(amount_int)
    return f'{amount_int / 100:.2f}'


def _normalize_account_monetary_fields(account: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(account)
    currency = str(out.get('currency') or 'USD')
    for field in ('amount_spent', 'balance'):
        if field in out:
            out[field] = _cents_to_currency(out[field], currency)
    return out


def _map_picker_row(acc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        'id': str(acc.get('id') or ''),
        'name': str(acc.get('name') or acc.get('id') or ''),
        'currency': acc.get('currency'),
        'status_label': ad_account_status_label(acc.get('account_status')),
        'account_status': acc.get('account_status'),
        'amount_spent': acc.get('amount_spent'),
        'balance': acc.get('balance'),
    }


def list_ad_accounts(
    access_token: str,
    *,
    user_id: str = 'me',
    limit: int = 200,
    api_version: str = 'v22.0',
    timeout: float = 120.0,
) -> Dict[str, Any]:
    """
    List ad accounts — reference ``get_ad_accounts``.

    ``amount_spent`` and ``balance`` are normalized to currency units (not cents).
    """
    if not access_token:
        return {'ok': False, 'error': 'access_token is required', 'data': [], 'accounts': []}

    uid = str(user_id or 'me').strip() or 'me'
    params: Dict[str, Any] = {
        'fields': _ACCOUNT_LIST_FIELDS,
        'limit': str(max(1, min(500, int(limit)))),
    }

    try:
        data = graph_request(
            f'{uid}/adaccounts',
            access_token,
            params=params,
            method='GET',
            api_version=api_version,
            timeout=timeout,
        )
    except GraphAPIError as exc:
        err = exc.error_data if isinstance(exc.error_data, dict) else {'message': str(exc)}
        return {'ok': False, 'error': format_graph_error(err), 'data': [], 'accounts': []}

    if data.get('ok') is False:
        return {**data, 'data': [], 'accounts': []}
    if isinstance(data, dict) and 'error' in data:
        err = data['error']
        return {
            'ok': False,
            'error': format_graph_error(err) if isinstance(err, dict) else str(err),
            'data': [],
            'accounts': [],
        }

    rows = [_normalize_account_monetary_fields(dict(x)) for x in (data.get('data') or [])]
    accounts = [_map_picker_row(x) for x in rows]
    return {'ok': True, 'data': rows, 'accounts': accounts, 'paging': data.get('paging')}


def fetch_me_adaccounts(
    access_token: str,
    *,
    api_version: str = 'v22.0',
    timeout: float = 120.0,
) -> Dict[str, Any]:
    """Backward-compatible picker shape — delegates to ``list_ad_accounts``."""
    res = list_ad_accounts(access_token, user_id='me', limit=500, api_version=api_version, timeout=timeout)
    if not res.get('ok'):
        return res
    return {'ok': True, 'accounts': res.get('accounts') or []}


def get_account_info(
    access_token: str,
    *,
    account_id: str,
    fields: str = '',
    api_version: str = 'v22.0',
    timeout: float = 120.0,
) -> Dict[str, Any]:
    """GET ad account — reference ``get_account_info`` (DSA flags, permission hints)."""
    if not account_id:
        return {'ok': False, 'error': 'account_id is required'}
    act_id = ensure_act_prefix(account_id)
    field_str = fields.strip() if fields and str(fields).strip() else _DEFAULT_ACCOUNT_INFO_FIELDS

    try:
        data = graph_request(
            act_id,
            access_token,
            params={'fields': field_str},
            method='GET',
            api_version=api_version,
            timeout=timeout,
        )
    except GraphAPIError as exc:
        err = exc.error_data if isinstance(exc.error_data, dict) else {'message': str(exc)}
        err_msg = format_graph_error(err).lower()
        if 'access' in err_msg or 'permission' in err_msg:
            accessible = list_ad_accounts(access_token, limit=50, api_version=api_version, timeout=timeout)
            hint = []
            if accessible.get('ok'):
                hint = [{'id': a['id'], 'name': a['name']} for a in (accessible.get('accounts') or [])[:10]]
            return {
                'ok': False,
                'error': f'Account {act_id} is not accessible to your user',
                'accessible_accounts': hint,
                'total_accessible_accounts': len(accessible.get('accounts') or []),
            }
        return {'ok': False, 'error': format_graph_error(err)}

    if data.get('ok') is False:
        return data
    if isinstance(data, dict) and 'error' in data:
        err = data['error']
        return {'ok': False, 'error': format_graph_error(err) if isinstance(err, dict) else str(err)}

    out = _normalize_account_monetary_fields(dict(data))
    bcc = out.get('business_country_code')
    if bcc:
        if str(bcc) in _EU_DSA_COUNTRIES:
            out['dsa_required'] = True
            out['dsa_compliance_note'] = 'This account is subject to European DSA requirements'
        else:
            out['dsa_required'] = False
            out['dsa_compliance_note'] = 'This account is not subject to European DSA requirements'

    return {'ok': True, 'account': out}
