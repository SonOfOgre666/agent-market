"""Google Ads account reads."""

from __future__ import annotations

import logging
from typing import Any, Dict, List

from .api import GoogleAdsClient, GoogleAdsException, digits_customer_id, load_client

logger = logging.getLogger(__name__)

_OAUTH_RECONNECT_HINT = (
    'Google Ads authorization expired or was revoked. '
    'Go to Accounts or Integrations and reconnect your Google Ads account, then try again.'
)


def _friendly_google_auth_error(exc: Exception) -> str:
    msg = str(exc)
    if 'invalid_grant' in msg.lower():
        return _OAUTH_RECONNECT_HINT
    return msg


def list_accessible_customer_ids(client: Any) -> List[str]:
    """IDs from ``CustomerService.list_accessible_customers``."""
    svc = client.get_service('CustomerService')
    response = svc.list_accessible_customers()
    out: List[str] = []
    for rn in response.resource_names:
        cid = str(rn).split('/')[-1]
        if cid:
            out.append(digits_customer_id(cid))
    return out


def fetch_customer_label(client: Any, customer_id: str) -> str:
    """Best-effort descriptive name for a customer id."""
    cid = digits_customer_id(customer_id)
    if not cid:
        return ''
    ga = client.get_service('GoogleAdsService')
    query = f"""
      SELECT customer.id, customer.descriptive_name, customer.currency_code
      FROM customer
      WHERE customer.id = {cid}
      LIMIT 1
    """
    try:
        rows = list(ga.search(customer_id=cid, query=query))
        if rows:
            c = rows[0].customer
            return str(c.descriptive_name or c.id or cid)
    except Exception as exc:
        logger.debug('[google_ads.accounts] label lookup %s: %s', cid, exc)
    return cid


def fetch_accessible_accounts(google_ads_client_config: Dict[str, Any]) -> Dict[str, Any]:
    """
    List Google Ads customer accounts accessible with the configured credentials.

    Returns ``{ok: True, accounts: [{customer_id, name, currency}]}``.
    """
    if GoogleAdsClient is None:
        return {'ok': False, 'error': 'google-ads library not installed'}
    if not google_ads_client_config:
        return {'ok': False, 'error': 'google_ads_client_config is required'}

    try:
        client = load_client(google_ads_client_config)
    except Exception as exc:
        return {'ok': False, 'error': _friendly_google_auth_error(exc)}

    try:
        ids = list_accessible_customer_ids(client)
    except GoogleAdsException as exc:  # type: ignore[misc]
        parts = [getattr(e, 'message', str(e)) for e in getattr(getattr(exc, 'failure', None), 'errors', []) or []]
        return {'ok': False, 'error': parts[0] if parts else str(exc)}
    except Exception as exc:
        return {'ok': False, 'error': _friendly_google_auth_error(exc)}

    accounts: List[Dict[str, Any]] = []
    for cid in ids:
        if not cid:
            continue
        name = fetch_customer_label(client, cid)
        currency = 'USD'
        try:
            ga = client.get_service('GoogleAdsService')
            q = f'SELECT customer.currency_code FROM customer WHERE customer.id = {cid} LIMIT 1'
            rows = list(ga.search(customer_id=cid, query=q))
            if rows and rows[0].customer.currency_code:
                currency = str(rows[0].customer.currency_code)
        except Exception:
            pass
        accounts.append({
            'customer_id': cid,
            'id': cid,
            'name': name,
            'currency': currency,
        })

    return {'ok': True, 'accounts': accounts}


def _is_blocking_customer_status(status: str | None, *, test_account: bool = False) -> bool:
    """Google API test accounts are intentionally CLOSED/cancelled — still publishable."""
    if test_account:
        return False
    status_up = str(status or '').upper()
    return status_up in ('CLOSED', 'CANCELED', 'CANCELLED', 'SUSPENDED')


def resolve_google_publish_customer(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    manager: bool,
    status: str | None = None,
    test_account: bool = False,
) -> Dict[str, Any]:
    """
    Resolve the customer id used for campaign mutations.
    Manager (MCC) accounts cannot host campaigns — pick a single client when possible.
    """
    cid = digits_customer_id(customer_id)
    if not cid:
        return {
            'publish_customer_id': None,
            'account_role': 'unknown',
            'publish_block_reason': 'customer_id is required',
        }

    if _is_blocking_customer_status(status, test_account=test_account):
        status_up = str(status or '').upper()
        return {
            'publish_customer_id': None,
            'account_role': 'client',
            'publish_block_reason': (
                f'The connected Google Ads account ({cid}) is {status_up}. '
                'Reconnect an active client account under Accounts.'
            ),
        }

    if not manager:
        return {'publish_customer_id': cid, 'account_role': 'client'}

    hier = fetch_account_hierarchy(google_ads_client_config, customer_id=cid, max_level=2)
    if not hier.get('ok'):
        return {
            'publish_customer_id': None,
            'account_role': 'manager',
            'publish_block_reason': (
                'This Google Ads connection is a manager (MCC) account. '
                f'Could not list client accounts: {hier.get("error") or "unknown error"}. '
                'Connect a client ad account directly under Accounts.'
            ),
        }

    clients = [
        row for row in (hier.get('hierarchy') or [])
        if not row.get('manager')
        and int(row.get('level') or 0) > 0
        and not _is_blocking_customer_status(
            str(row.get('status') or ''),
            test_account=bool(row.get('test_account')),
        )
    ]
    if len(clients) == 1:
        client = clients[0]
        return {
            'publish_customer_id': str(client.get('customer_id') or ''),
            'account_role': 'manager',
            'publish_client_name': str(client.get('name') or ''),
            'manager_customer_id': cid,
        }
    if not clients:
        return {
            'publish_customer_id': None,
            'account_role': 'manager',
            'publish_block_reason': (
                'This Google Ads connection is a manager (MCC) account with no active client '
                'accounts. Add a client under the MCC in Google Ads, or connect a client account '
                'directly in Agent Market → Accounts.'
            ),
        }
    listing = ', '.join(
        f'{c.get("name")} ({c.get("customer_id")})' for c in clients[:6]
    )
    return {
        'publish_customer_id': None,
        'account_role': 'manager',
        'publish_block_reason': (
            'This Google Ads connection is a manager (MCC) account. Campaigns must be created '
            f'on a client account. Available clients: {listing}. '
            'Connect the specific client you want under Accounts.'
        ),
    }


def fetch_customer_info(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
) -> Dict[str, Any]:
    """
    Customer profile for the connected account (reference get_account_info parity with meta_get_account).
    """
    if GoogleAdsClient is None:
        return {'ok': False, 'error': 'google-ads library not installed'}
    if not google_ads_client_config:
        return {'ok': False, 'error': 'google_ads_client_config is required'}

    cid = digits_customer_id(customer_id)
    if not cid:
        return {'ok': False, 'error': 'customer_id is required'}

    try:
        client = load_client(google_ads_client_config)
    except Exception as exc:
        return {'ok': False, 'error': _friendly_google_auth_error(exc)}

    ga = client.get_service('GoogleAdsService')
    query = f"""
      SELECT
        customer.id,
        customer.descriptive_name,
        customer.currency_code,
        customer.time_zone,
        customer.auto_tagging_enabled,
        customer.test_account,
        customer.manager,
        customer.status
      FROM customer
      WHERE customer.id = {cid}
      LIMIT 1
    """
    try:
        rows = list(ga.search(customer_id=cid, query=query))
    except GoogleAdsException as exc:  # type: ignore[misc]
        parts = [getattr(e, 'message', str(e)) for e in getattr(getattr(exc, 'failure', None), 'errors', []) or []]
        return {'ok': False, 'error': parts[0] if parts else str(exc)}
    except Exception as exc:
        return {'ok': False, 'error': _friendly_google_auth_error(exc)}

    if not rows:
        return {'ok': False, 'error': f'Customer {cid} not found'}

    c = rows[0].customer
    info = {
        'ok': True,
        'customer_id': str(c.id),
        'name': str(c.descriptive_name or c.id),
        'currency': str(c.currency_code or 'USD'),
        'timezone': str(c.time_zone or ''),
        'auto_tagging_enabled': bool(c.auto_tagging_enabled),
        'test_account': bool(c.test_account),
        'manager': bool(c.manager),
        'status': str(c.status.name if hasattr(c.status, 'name') else c.status),
    }
    publish = resolve_google_publish_customer(
        google_ads_client_config,
        customer_id=info['customer_id'],
        manager=info['manager'],
        status=info['status'],
        test_account=info['test_account'],
    )
    info.update(publish)
    return info


def fetch_account_hierarchy(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    max_level: int = 2,
) -> Dict[str, Any]:
    """MCC / client tree (reference get_account_hierarchy)."""
    cid = digits_customer_id(customer_id)
    if not cid:
        return {'ok': False, 'error': 'customer_id is required'}
    try:
        client = load_client(google_ads_client_config)
    except Exception as exc:
        return {'ok': False, 'error': _friendly_google_auth_error(exc)}

    ga = client.get_service('GoogleAdsService')
    lvl = max(0, min(int(max_level or 2), 5))
    query = f"""
      SELECT
        customer_client.id,
        customer_client.descriptive_name,
        customer_client.manager,
        customer_client.level,
        customer_client.time_zone,
        customer_client.currency_code,
        customer_client.status,
        customer_client.test_account
      FROM customer_client
      WHERE customer_client.level <= {lvl}
    """
    try:
        rows = list(ga.search(customer_id=cid, query=query))
    except GoogleAdsException as exc:  # type: ignore[misc]
        parts = [getattr(e, 'message', str(e)) for e in getattr(getattr(exc, 'failure', None), 'errors', []) or []]
        return {'ok': False, 'error': parts[0] if parts else str(exc)}

    hierarchy = []
    for row in rows:
        cc = row.customer_client
        hierarchy.append({
            'customer_id': str(cc.id),
            'name': str(cc.descriptive_name or cc.id),
            'manager': bool(cc.manager),
            'level': int(cc.level or 0),
            'timezone': str(cc.time_zone or ''),
            'currency': str(cc.currency_code or ''),
            'status': str(cc.status.name if hasattr(cc.status, 'name') else cc.status),
            'test_account': bool(cc.test_account),
        })
    return {'ok': True, 'hierarchy': hierarchy, 'count': len(hierarchy)}
