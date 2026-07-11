"""Recommendations & change history (reference advanced tools via GAQL)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from .api import digits_customer_id, load_client


def list_recommendations(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    limit: int = 50,
) -> Dict[str, Any]:
    cid = digits_customer_id(customer_id)
    if not cid:
        return {'ok': False, 'error': 'customer_id is required'}
    client = load_client(google_ads_client_config)
    ga = client.get_service('GoogleAdsService')
    q = """
      SELECT
        recommendation.resource_name,
        recommendation.type,
        recommendation.campaign,
        recommendation.impact.base_metrics.clicks,
        recommendation.impact.base_metrics.cost_micros
      FROM recommendation
      LIMIT 100
    """
    items: List[Dict[str, Any]] = []
    for row in ga.search(customer_id=cid, query=q):
        rec = row.recommendation
        items.append({
            'resource_name': rec.resource_name,
            'type': str(rec.type_.name if hasattr(rec.type_, 'name') else rec.type_),
            'campaign': str(rec.campaign or ''),
        })
        if len(items) >= max(1, min(int(limit or 50), 100)):
            break
    return {'ok': True, 'data': items, 'count': len(items)}


def apply_recommendation(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    recommendation_resource_name: str,
) -> Dict[str, Any]:
    cid = digits_customer_id(customer_id)
    rn = (recommendation_resource_name or '').strip()
    if not cid or not rn:
        return {'ok': False, 'error': 'customer_id and recommendation_resource_name required'}
    client = load_client(google_ads_client_config)
    svc = client.get_service('RecommendationService')
    op = client.get_type('ApplyRecommendationOperation')
    op.resource_name = rn
    req = client.get_type('ApplyRecommendationRequest')
    req.customer_id = cid
    req.operations = [op]
    resp = svc.apply_recommendation(request=req)
    return {'ok': True, 'results': [str(r.resource_name) for r in resp.results]}


def get_change_history(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    date_range: str = 'LAST_30_DAYS',
    limit: int = 100,
) -> Dict[str, Any]:
    cid = digits_customer_id(customer_id)
    dr = (date_range or 'LAST_30_DAYS').strip().upper()
    if dr not in ('LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS', 'LAST_90_DAYS'):
        dr = 'LAST_30_DAYS'
    client = load_client(google_ads_client_config)
    ga = client.get_service('GoogleAdsService')
    q = f"""
      SELECT
        change_status.resource_name,
        change_status.last_change_date_time,
        change_status.resource_type,
        change_status.resource_status,
        campaign.id, campaign.name
      FROM change_status
      WHERE change_status.last_change_date_time DURING {dr}
      ORDER BY change_status.last_change_date_time DESC
      LIMIT 200
    """
    items: List[Dict[str, Any]] = []
    for row in ga.search(customer_id=cid, query=q):
        cs = row.change_status
        items.append({
            'resource_name': cs.resource_name,
            'changed_at': str(cs.last_change_date_time),
            'resource_type': str(cs.resource_type.name if hasattr(cs.resource_type, 'name') else cs.resource_type),
            'status': str(cs.resource_status.name if hasattr(cs.resource_status, 'name') else cs.resource_status),
            'campaign_id': str(row.campaign.id) if row.campaign else '',
            'campaign_name': row.campaign.name if row.campaign else '',
        })
        if len(items) >= max(1, min(int(limit or 100), 200)):
            break
    return {'ok': True, 'data': items, 'count': len(items)}
