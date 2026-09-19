"""Google Ads campaign budget mutations (reference create_campaign_budget)."""

from __future__ import annotations

from typing import Any, Dict

from .api import GoogleAdsLibraryMissing, digits_customer_id, health_check, load_client
from .utils import client_enum, resolve_enum


def create_campaign_budget(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    name: str,
    amount_micros: int,
    delivery_method: str = 'STANDARD',
) -> Dict[str, Any]:
    """Create a campaign budget; returns resource_name."""
    if not health_check():
        raise GoogleAdsLibraryMissing()

    cid = digits_customer_id(customer_id)
    if not cid:
        return {'ok': False, 'error': 'customer_id is required'}
    budget_name = (name or '').strip()
    if not budget_name:
        return {'ok': False, 'error': 'name is required'}
    if amount_micros <= 0:
        return {'ok': False, 'error': 'amount_micros must be positive'}

    client = load_client(google_ads_client_config)
    svc = client.get_service('CampaignBudgetService')
    op = client.get_type('CampaignBudgetOperation')
    b = op.create
    b.name = budget_name
    b.amount_micros = int(amount_micros)
    b.delivery_method = resolve_enum(
        client_enum(client, 'BudgetDeliveryMethodEnum'),
        delivery_method,
        'delivery_method',
    )
    b.explicitly_shared = False

    resp = svc.mutate_campaign_budgets(customer_id=cid, operations=[op])
    rn = resp.results[0].resource_name
    return {'ok': True, 'resource_name': rn, 'budget_resource_name': rn}


def list_campaign_budgets(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    limit: int = 50,
) -> Dict[str, Any]:
    """List campaign budgets (reference list_budgets)."""
    cid = digits_customer_id(customer_id)
    if not cid:
        return {'ok': False, 'error': 'customer_id is required'}
    client = load_client(google_ads_client_config)
    ga = client.get_service('GoogleAdsService')
    q = """
      SELECT campaign_budget.id, campaign_budget.name, campaign_budget.amount_micros,
             campaign_budget.status, campaign_budget.delivery_method, campaign_budget.resource_name
      FROM campaign_budget
      WHERE campaign_budget.status != 'REMOVED'
      ORDER BY campaign_budget.name
      LIMIT 200
    """
    items = []
    for row in ga.search(customer_id=cid, query=q):
        b = row.campaign_budget
        items.append({
            'budget_id': str(b.id),
            'name': b.name,
            'amount_micros': int(b.amount_micros or 0),
            'amount': (b.amount_micros or 0) / 1_000_000,
            'status': str(b.status.name if hasattr(b.status, 'name') else b.status),
            'delivery_method': str(b.delivery_method.name if hasattr(b.delivery_method, 'name') else b.delivery_method),
            'resource_name': b.resource_name,
        })
        if len(items) >= max(1, min(int(limit or 50), 200)):
            break
    return {'ok': True, 'data': items, 'count': len(items)}


def update_campaign_budget(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    budget_id: str,
    amount_micros: int | None = None,
    name: str | None = None,
) -> Dict[str, Any]:
    """Update budget amount or name (reference update_budget)."""
    from google.protobuf import field_mask_pb2

    cid = digits_customer_id(customer_id)
    bid = ''.join(c for c in str(budget_id or '') if c.isdigit())
    if not cid or not bid:
        return {'ok': False, 'error': 'customer_id and budget_id are required'}
    if amount_micros is None and not (name or '').strip():
        return {'ok': False, 'error': 'amount_micros or name is required'}

    client = load_client(google_ads_client_config)
    svc = client.get_service('CampaignBudgetService')
    op = client.get_type('CampaignBudgetOperation')
    b = op.update
    b.resource_name = svc.campaign_budget_path(cid, bid)
    paths = []
    if amount_micros is not None:
        b.amount_micros = int(amount_micros)
        paths.append('amount_micros')
    if (name or '').strip():
        b.name = name.strip()
        paths.append('name')
    op.update_mask.CopyFrom(field_mask_pb2.FieldMask(paths=paths))
    resp = svc.mutate_campaign_budgets(customer_id=cid, operations=[op])
    rn = resp.results[0].resource_name
    return {'ok': True, 'resource_name': rn, 'budget_resource_name': rn}
