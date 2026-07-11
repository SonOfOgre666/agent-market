"""Geo performance reads (reference tools_geography.py)."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from .api import digits_customer_id, load_client


def _safe_date_range(dr: str) -> str:
    d = (dr or 'LAST_30_DAYS').strip().upper()
    return d if d in ('LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS', 'LAST_90_DAYS') else 'LAST_30_DAYS'


def get_location_performance(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    campaign_id: Optional[str] = None,
    date_range: str = 'LAST_30_DAYS',
) -> Dict[str, Any]:
    cid = digits_customer_id(customer_id)
    camp = ''.join(c for c in str(campaign_id or '') if c.isdigit()) if campaign_id else ''
    dr = _safe_date_range(date_range)
    client = load_client(google_ads_client_config)
    ga = client.get_service('GoogleAdsService')
    q = f"""
      SELECT
        geographic_view.country_criterion_id,
        geographic_view.location_type,
        campaign.id, campaign.name,
        metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions
      FROM geographic_view
      WHERE segments.date DURING {dr}
    """
    if camp:
        q += f' AND campaign.id = {camp}'
    items: List[Dict[str, Any]] = []
    for row in ga.search(customer_id=cid, query=q):
        gv = row.geographic_view
        met = row.metrics
        items.append({
            'geo_target_id': str(gv.country_criterion_id),
            'location_type': str(gv.location_type.name if hasattr(gv.location_type, 'name') else gv.location_type),
            'campaign_id': str(row.campaign.id),
            'clicks': int(met.clicks or 0),
            'impressions': int(met.impressions or 0),
            'cost': float((met.cost_micros or 0) / 1_000_000),
            'conversions': float(met.conversions or 0),
        })
    return {'ok': True, 'data': items, 'count': len(items)}


def suggest_negative_keywords_from_search_terms(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    campaign_id: Optional[str] = None,
    date_range: str = 'LAST_30_DAYS',
    min_cost: float = 5.0,
    max_suggestions: int = 20,
) -> Dict[str, Any]:
    """High-cost search terms as negative keyword suggestions (reference auto_suggest_negative_keywords)."""
    cid = digits_customer_id(customer_id)
    camp = ''.join(c for c in str(campaign_id or '') if c.isdigit()) if campaign_id else ''
    dr = _safe_date_range(date_range)
    client = load_client(google_ads_client_config)
    ga = client.get_service('GoogleAdsService')
    q = f"""
      SELECT
        search_term_view.search_term,
        metrics.cost_micros, metrics.clicks, metrics.conversions,
        campaign.id
      FROM search_term_view
      WHERE segments.date DURING {dr}
    """
    if camp:
        q += f' AND campaign.id = {camp}'
    q += ' ORDER BY metrics.cost_micros DESC LIMIT 100'
    min_micros = int(float(min_cost) * 1_000_000)
    suggestions: List[Dict[str, Any]] = []
    for row in ga.search(customer_id=cid, query=q):
        cost = int(row.metrics.cost_micros or 0)
        if cost < min_micros:
            continue
        term = str(row.search_term_view.search_term or '').strip()
        if not term:
            continue
        suggestions.append({
            'search_term': term,
            'cost': cost / 1_000_000,
            'clicks': int(row.metrics.clicks or 0),
            'conversions': float(row.metrics.conversions or 0),
            'campaign_id': str(row.campaign.id),
        })
        if len(suggestions) >= max(1, min(int(max_suggestions or 20), 50)):
            break
    return {'ok': True, 'suggestions': suggestions, 'count': len(suggestions)}


def optimize_geographic_targeting(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    campaign_id: str,
    date_range: str = 'LAST_30_DAYS',
    min_cost_threshold: float = 20.0,
    poor_roas_threshold: float = 1.0,
) -> Dict[str, Any]:
    """Analyze geo performance and return bid/exclude recommendations (reference optimize_geographic_targeting)."""
    perf = get_location_performance(
        google_ads_client_config,
        customer_id=customer_id,
        campaign_id=campaign_id,
        date_range=date_range,
    )
    if not perf.get('ok'):
        return perf

    rows = perf.get('data') or []
    if not rows:
        return {'ok': True, 'recommendations': [], 'message': 'No geographic data for period'}

    total_cost = sum(r.get('cost', 0) for r in rows)
    total_conv = sum(r.get('conversions', 0) for r in rows)
    avg_cpa = (total_cost / total_conv) if total_conv > 0 else None

    recommendations: List[Dict[str, Any]] = []
    for row in rows:
        cost = float(row.get('cost') or 0)
        conv = float(row.get('conversions') or 0)
        geo_id = row.get('geo_target_id')
        if cost < min_cost_threshold:
            continue
        roas = (conv / cost) if cost > 0 else 0
        cpa = (cost / conv) if conv > 0 else None
        if conv == 0 and cost >= min_cost_threshold:
            recommendations.append({
                'action': 'exclude',
                'geo_target_id': geo_id,
                'reason': f'Spend ${cost:.2f} with zero conversions',
                'potential_savings': cost,
            })
        elif avg_cpa and cpa and cpa > avg_cpa * 2:
            recommendations.append({
                'action': 'decrease_bid',
                'geo_target_id': geo_id,
                'suggested_bid_modifier': 0.8,
                'reason': f'High CPA ${cpa:.2f} vs avg',
            })
        elif roas >= poor_roas_threshold * 1.5 and cost >= min_cost_threshold:
            recommendations.append({
                'action': 'increase_bid',
                'geo_target_id': geo_id,
                'suggested_bid_modifier': 1.2,
                'reason': f'Strong efficiency (conv/cost={roas:.2f})',
            })

    return {
        'ok': True,
        'recommendations': recommendations,
        'count': len(recommendations),
        'summary': {'total_cost': total_cost, 'total_conversions': total_conv},
    }
