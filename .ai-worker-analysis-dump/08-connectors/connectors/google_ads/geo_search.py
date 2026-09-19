"""Geo target constant search (Meta search_geo_locations parity)."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from .api import GoogleAdsException, digits_customer_id, format_google_ads_exception, load_client


def _safe_query_fragment(text: str) -> str:
    return re.sub(r"['\\]", '', (text or '').strip())[:80]


def search_geo_target_constants(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    query: str,
    locale: str = 'en',
    country_code: Optional[str] = None,
    limit: int = 25,
) -> Dict[str, Any]:
    """
    Resolve location names to geo_target_constant IDs.

    Uses GeoTargetConstantService.suggestGeoTargetConstants when available,
    otherwise GAQL on geo_target_constant.
    """
    cid = digits_customer_id(customer_id)
    q = _safe_query_fragment(query)
    if not cid or not q:
        return {'ok': False, 'error': 'customer_id and query are required'}

    client = load_client(google_ads_client_config)
    cap = max(1, min(int(limit or 25), 50))
    items: List[Dict[str, Any]] = []

    geo_svc = client.get_service('GeoTargetConstantService')
    if hasattr(geo_svc, 'suggest_geo_target_constants'):
        try:
            req = client.get_type('SuggestGeoTargetConstantsRequest')
            req.locale = (locale or 'en').strip() or 'en'
            req.country_code = (country_code or '').strip().upper() or None
            if hasattr(req, 'location_names'):
                req.location_names.names.append(q)
            else:
                req.query = q
            resp = geo_svc.suggest_geo_target_constants(request=req)
            suggestions = getattr(resp, 'geo_target_constant_suggestions', []) or []
            for row in suggestions:
                gtc = getattr(row, 'geo_target_constant', None)
                if gtc is None:
                    continue
                items.append({
                    'geo_target_constant_id': int(gtc.id),
                    'name': str(getattr(gtc, 'name', '') or ''),
                    'country_code': str(getattr(gtc, 'country_code', '') or ''),
                    'target_type': str(getattr(gtc, 'target_type', '') or ''),
                    'resource_name': str(getattr(gtc, 'resource_name', '') or ''),
                })
                if len(items) >= cap:
                    break
            if items:
                return {'ok': True, 'data': items, 'count': len(items)}
        except GoogleAdsException as exc:  # type: ignore[misc]
            return {'ok': False, 'error': format_google_ads_exception(exc)}
        except Exception as exc:
            pass  # fall through to GAQL

    ga = client.get_service('GoogleAdsService')
    gaql = f"""
      SELECT
        geo_target_constant.id,
        geo_target_constant.name,
        geo_target_constant.country_code,
        geo_target_constant.target_type,
        geo_target_constant.resource_name
      FROM geo_target_constant
      WHERE geo_target_constant.name LIKE '%{q}%'
        AND geo_target_constant.status = 'ENABLED'
      LIMIT {cap}
    """
    try:
        for row in ga.search(customer_id=cid, query=gaql):
            gtc = row.geo_target_constant
            items.append({
                'geo_target_constant_id': int(gtc.id),
                'name': str(gtc.name or ''),
                'country_code': str(gtc.country_code or ''),
                'target_type': str(gtc.target_type.name if hasattr(gtc.target_type, 'name') else gtc.target_type),
                'resource_name': str(gtc.resource_name or ''),
            })
    except GoogleAdsException as exc:  # type: ignore[misc]
        return {'ok': False, 'error': format_google_ads_exception(exc)}
    except Exception as exc:
        return {'ok': False, 'error': str(exc)}

    return {'ok': True, 'data': items, 'count': len(items)}
