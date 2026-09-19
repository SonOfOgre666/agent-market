"""Merchant Center link reads for Shopping / retail PMax."""

from __future__ import annotations

from typing import Any, Dict, List

from .api import GoogleAdsException, digits_customer_id, format_google_ads_exception, load_client


def list_merchant_center_links(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
) -> Dict[str, Any]:
    """GAQL product_link — enabled Merchant Center accounts."""
    cid = digits_customer_id(customer_id)
    if not cid:
        return {'ok': False, 'error': 'customer_id is required'}

    client = load_client(google_ads_client_config)
    ga = client.get_service('GoogleAdsService')
    q = """
      SELECT
        product_link.merchant_center.merchant_center_id,
        product_link.status,
        product_link.type
      FROM product_link
      WHERE product_link.status = 'ENABLED'
    """
    items: List[Dict[str, Any]] = []
    try:
        for row in ga.search(customer_id=cid, query=q):
            pl = row.product_link
            mc = pl.merchant_center
            mid = str(getattr(mc, 'merchant_center_id', '') or '')
            if not mid:
                continue
            items.append({
                'merchant_id': mid,
                'status': str(pl.status.name if hasattr(pl.status, 'name') else pl.status),
                'type': str(pl.type_.name if hasattr(pl.type_, 'name') else pl.type_),
            })
    except GoogleAdsException as exc:  # type: ignore[misc]
        return {'ok': False, 'error': format_google_ads_exception(exc)}
    except Exception as exc:
        return {'ok': False, 'error': str(exc)}

    return {'ok': True, 'data': items, 'count': len(items), 'merchant_centers': items}
