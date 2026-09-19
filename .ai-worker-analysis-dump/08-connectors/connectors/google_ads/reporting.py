"""
Google Ads GAQL reporting reads — parity with ``GoogleAdsProvider`` reporting methods (apps/api).
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

from .api import GoogleAdsException, digits_customer_id, load_client

logger = logging.getLogger(__name__)

try:
    from google.protobuf.json_format import MessageToDict
except ImportError:  # pragma: no cover
    MessageToDict = None  # type: ignore[misc, assignment]


def preprocess_gaql(query: str) -> str:
    """Subset of ``GoogleAdsProvider._preprocessGaql``: add ``omit_unselected_resource_names`` (Node parity for arbitrary GAQL)."""
    q = (query or '').strip()

    def strip_where_parens(m: re.Match[str]) -> str:
        inner = m.group(1)
        if re.search(r'\bAND\b', inner, re.I) and not inner.strip().startswith("'"):
            return inner
        return m.group(0)

    q = re.sub(r'\(\s*((?:(?!\bIN\b).)*?\bAND\b.*?)\s*\)', strip_where_parens, q, flags=re.IGNORECASE)

    low = q.lower()
    if 'omit_unselected_resource_names' not in low:
        if 'parameters' in low:
            q = q.rstrip() + ', omit_unselected_resource_names=true'
        else:
            q = q.rstrip() + ' PARAMETERS omit_unselected_resource_names=true'
    return q


def _map_status(status: Any) -> str:
    if isinstance(status, (int, float)) and not isinstance(status, bool):
        return {2: 'active', 3: 'paused', 4: 'ended'}.get(int(status), 'draft')
    s = str(status or '').upper()
    return {'ENABLED': 'active', 'PAUSED': 'paused', 'REMOVED': 'ended'}.get(s, 'draft')


def _map_channel_type(t: Any) -> str:
    if isinstance(t, (int, float)) and not isinstance(t, bool):
        return {2: 'search', 3: 'display', 5: 'video', 6: 'shopping', 8: 'performance_max'}.get(int(t), 'search')
    u = str(t or '').upper()
    return {
        'SEARCH': 'search',
        'DISPLAY': 'display',
        'SHOPPING': 'shopping',
        'VIDEO': 'video',
        'SMART': 'smart',
        'PERFORMANCE_MAX': 'performance_max',
    }.get(u, 'search')


def _safe_date_range(dr: Any) -> str:
    s = str(dr or 'LAST_30_DAYS').strip().upper()
    if re.match(r'^[A-Z0-9_]+$', s):
        return s
    return 'LAST_30_DAYS'


def _safe_digits_id(x: Any) -> Optional[str]:
    d = digits_customer_id(x)
    return d or None


def _iter_search(client: Any, customer_id: str, query: str) -> List[Any]:
    cid = digits_customer_id(customer_id)
    if not cid:
        return []
    ga = client.get_service('GoogleAdsService')
    rows: List[Any] = []
    try:
        if hasattr(ga, 'search'):
            rows = list(ga.search(customer_id=cid, query=query))
        else:
            stream = ga.search_stream(customer_id=cid, query=query)
            for batch in stream:
                rows.extend(list(batch.results))
    except GoogleAdsException:
        raise
    except Exception as exc:
        logger.warning('[google_ads_reporting] search failed: %s', exc)
        raise
    return rows


def run_google_ads_reporting(
    google_ads_client_config: Dict[str, Any],
    customer_id: str,
    operation: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Returns ``{'response_type': 'items'|'object', 'payload': ...}`` for API envelope.
    """
    if not google_ads_client_config:
        raise ValueError('Missing Google Ads client config')
    cid = digits_customer_id(customer_id)
    if not cid:
        raise ValueError('No Google Ads customer_id associated with this account')

    client = load_client(google_ads_client_config)
    op = (operation or '').strip().lower()
    pl = payload or {}

    if op == 'performance':
        date_range = _safe_date_range(pl.get('date_range'))
        camp = _safe_digits_id(pl.get('campaign_id'))
        include_removed = bool(pl.get('include_removed'))
        q = f"""
      SELECT
        campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
        campaign_budget.amount_micros,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value, metrics.ctr,
        metrics.average_cpc, metrics.cost_per_conversion
      FROM campaign
      WHERE segments.date DURING {date_range}
    """
        if camp:
            q += f' AND campaign.id = {camp}'
        if not include_removed:
            q += " AND campaign.status != 'REMOVED'"
        q += ' ORDER BY metrics.cost_micros DESC'
        rows = _iter_search(client, cid, q)
        items: List[Dict[str, Any]] = []
        for row in rows:
            c = row.campaign
            met = row.metrics
            cb = getattr(row, 'campaign_budget', None)
            amount_micros = int(getattr(cb, 'amount_micros', None) or 0) if cb else 0
            items.append(
                {
                    'campaign_id': str(c.id),
                    'campaign_name': c.name,
                    'status': _map_status(c.status),
                    'channel_type': _map_channel_type(c.advertising_channel_type),
                    'budget': float(f'{(amount_micros / 1_000_000):.2f}') if amount_micros else None,
                    'budget_type': 'daily',
                    'impressions': int(met.impressions or 0),
                    'clicks': int(met.clicks or 0),
                    'cost': float(f'{((met.cost_micros or 0) / 1_000_000):.2f}'),
                    'conversions': float(met.conversions or 0),
                    'conversion_value': float(met.conversions_value or 0),
                    'ctr': float(met.ctr or 0),
                    'average_cpc': float(f'{((met.average_cpc or 0) / 1_000_000):.4f}'),
                    'cost_per_conversion': float(f'{((met.cost_per_conversion or 0) / 1_000_000):.2f}'),
                }
            )
        return {'response_type': 'items', 'payload': items}

    if op == 'ad_groups':
        camp = _safe_digits_id(pl.get('campaign_id'))
        status = pl.get('status')
        q = """
      SELECT
        ad_group.id, ad_group.name, ad_group.status, ad_group.type,
        ad_group.cpc_bid_micros,
        campaign.id, campaign.name,
        metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
      FROM ad_group
      WHERE ad_group.status != 'REMOVED'
    """
        if camp:
            q += f' AND campaign.id = {camp}'
        if status and re.match(r'^[A-Z_]+$', str(status).strip().upper()):
            q += f" AND ad_group.status = '{str(status).strip().upper()}'"
        q += ' ORDER BY ad_group.name'
        rows = _iter_search(client, cid, q)
        items = []
        for row in rows:
            ag = row.ad_group
            c = row.campaign
            met = row.metrics
            items.append(
                {
                    'ad_group_id': str(ag.id),
                    'ad_group_name': ag.name,
                    'status': _map_status(ag.status),
                    'type': str(ag.type or ''),
                    'cpc_bid': float(f'{((ag.cpc_bid_micros or 0) / 1_000_000):.4f}'),
                    'campaign_id': str(c.id or ''),
                    'campaign_name': c.name or '',
                    'impressions': int(met.impressions or 0),
                    'clicks': int(met.clicks or 0),
                    'cost': float(f'{((met.cost_micros or 0) / 1_000_000):.2f}'),
                    'conversions': float(met.conversions or 0),
                }
            )
        return {'response_type': 'items', 'payload': items}

    if op == 'keywords':
        date_range = _safe_date_range(pl.get('date_range'))
        camp = _safe_digits_id(pl.get('campaign_id'))
        agid = _safe_digits_id(pl.get('ad_group_id'))
        min_imp = int(pl.get('min_impressions') or 0)
        q = f"""
      SELECT
        ad_group_criterion.criterion_id, ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type, ad_group_criterion.status,
        ad_group_criterion.quality_info.quality_score,
        campaign.id, campaign.name, ad_group.id, ad_group.name,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.ctr, metrics.average_cpc
      FROM keyword_view
      WHERE segments.date DURING {date_range}
        AND ad_group_criterion.status != 'REMOVED'
    """
        if camp:
            q += f' AND campaign.id = {camp}'
        if agid:
            q += f' AND ad_group.id = {agid}'
        if min_imp > 0:
            q += f' AND metrics.impressions >= {min_imp}'
        q += ' ORDER BY metrics.cost_micros DESC'
        rows = _iter_search(client, cid, q)
        items = []
        for row in rows:
            crit = row.ad_group_criterion
            c = row.campaign
            ag = row.ad_group
            met = row.metrics
            kw = getattr(crit, 'keyword', None)
            qi = getattr(crit, 'quality_info', None)
            items.append(
                {
                    'keyword_id': str(getattr(crit, 'criterion_id', None) or ''),
                    'keyword_text': getattr(kw, 'text', None) or '' if kw else '',
                    'match_type': str(getattr(kw, 'match_type', None) or '') if kw else '',
                    'status': _map_status(getattr(crit, 'status', None)),
                    'quality_score': getattr(qi, 'quality_score', None) if qi else None,
                    'campaign_id': str(c.id or ''),
                    'campaign_name': c.name or '',
                    'ad_group_id': str(ag.id or ''),
                    'ad_group_name': ag.name or '',
                    'impressions': int(met.impressions or 0),
                    'clicks': int(met.clicks or 0),
                    'cost': float(f'{((met.cost_micros or 0) / 1_000_000):.2f}'),
                    'conversions': float(met.conversions or 0),
                    'ctr': float(met.ctr or 0),
                    'average_cpc': float(f'{((met.average_cpc or 0) / 1_000_000):.4f}'),
                }
            )
        return {'response_type': 'items', 'payload': items}

    if op == 'ads':
        date_range = _safe_date_range(pl.get('date_range'))
        camp = _safe_digits_id(pl.get('campaign_id'))
        agid = _safe_digits_id(pl.get('ad_group_id'))
        q = f"""
      SELECT
        ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.status,
        campaign.id, campaign.name, ad_group.id, ad_group.name,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.ctr, metrics.average_cpc
      FROM ad_group_ad
      WHERE segments.date DURING {date_range}
        AND ad_group_ad.status != 'REMOVED'
    """
        if camp:
            q += f' AND campaign.id = {camp}'
        if agid:
            q += f' AND ad_group.id = {agid}'
        q += ' ORDER BY metrics.cost_micros DESC'
        rows = _iter_search(client, cid, q)
        items = []
        for row in rows:
            aga = row.ad_group_ad
            c = row.campaign
            ag = row.ad_group
            met = row.metrics
            ad = getattr(aga, 'ad', None)
            items.append(
                {
                    'ad_id': str(getattr(ad, 'id', None) or '') if ad else '',
                    'ad_type': str(getattr(ad, 'type', None) or '') if ad else '',
                    'status': _map_status(getattr(aga, 'status', None)),
                    'campaign_id': str(c.id or ''),
                    'campaign_name': c.name or '',
                    'ad_group_id': str(ag.id or ''),
                    'ad_group_name': ag.name or '',
                    'impressions': int(met.impressions or 0),
                    'clicks': int(met.clicks or 0),
                    'cost': float(f'{((met.cost_micros or 0) / 1_000_000):.2f}'),
                    'conversions': float(met.conversions or 0),
                    'ctr': float(met.ctr or 0),
                    'average_cpc': float(f'{((met.average_cpc or 0) / 1_000_000):.4f}'),
                }
            )
        return {'response_type': 'items', 'payload': items}

    if op == 'search_terms':
        date_range = _safe_date_range(pl.get('date_range'))
        camp = _safe_digits_id(pl.get('campaign_id'))
        agid = _safe_digits_id(pl.get('ad_group_id'))
        min_imp = int(pl.get('min_impressions') or 0)
        q = f"""
      SELECT
        search_term_view.search_term, search_term_view.status,
        segments.keyword.info.text, segments.keyword.info.match_type,
        campaign.id, campaign.name, ad_group.id, ad_group.name,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.ctr
      FROM search_term_view
      WHERE segments.date DURING {date_range}
    """
        if camp:
            q += f' AND campaign.id = {camp}'
        if agid:
            q += f' AND ad_group.id = {agid}'
        if min_imp > 0:
            q += f' AND metrics.impressions >= {min_imp}'
        q += ' ORDER BY metrics.cost_micros DESC'
        rows = _iter_search(client, cid, q)
        items = []
        for row in rows:
            stv = row.search_term_view
            seg = row.segments
            c = row.campaign
            ag = row.ad_group
            met = row.metrics
            kinfo = getattr(getattr(seg, 'keyword', None), 'info', None) if seg else None
            items.append(
                {
                    'search_term': getattr(stv, 'search_term', None) or '' if stv else '',
                    'keyword_text': getattr(kinfo, 'text', None) or '' if kinfo else '',
                    'match_type': str(getattr(kinfo, 'match_type', None) or '') if kinfo else '',
                    'campaign_id': str(c.id or ''),
                    'campaign_name': c.name or '',
                    'ad_group_id': str(ag.id or ''),
                    'ad_group_name': ag.name or '',
                    'impressions': int(met.impressions or 0),
                    'clicks': int(met.clicks or 0),
                    'cost': float(f'{((met.cost_micros or 0) / 1_000_000):.2f}'),
                    'conversions': float(met.conversions or 0),
                    'ctr': float(met.ctr or 0),
                }
            )
        return {'response_type': 'items', 'payload': items}

    if op == 'daily':
        date_range = _safe_date_range(pl.get('date_range'))
        camp = _safe_digits_id(pl.get('campaign_id'))
        q = f"""
      SELECT
        segments.date,
        metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
      FROM customer
      WHERE segments.date DURING {date_range}
    """
        if camp:
            q = f"""
      SELECT
        segments.date,
        metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
      FROM campaign
      WHERE segments.date DURING {date_range}
        AND campaign.id = {camp}
    """
        q += ' ORDER BY segments.date'
        rows = _iter_search(client, cid, q)
        by_date: Dict[str, Dict[str, float]] = {}
        for row in rows:
            seg = getattr(row, 'segments', None)
            date_str = str(getattr(seg, 'date', None) or '') if seg else ''
            if not date_str:
                continue
            met = row.metrics
            bucket = by_date.setdefault(
                date_str,
                {'date': date_str, 'spend': 0.0, 'clicks': 0.0, 'impressions': 0.0, 'conversions': 0.0},
            )
            bucket['impressions'] += int(met.impressions or 0)
            bucket['clicks'] += int(met.clicks or 0)
            bucket['spend'] += float((met.cost_micros or 0) / 1_000_000)
            bucket['conversions'] += float(met.conversions or 0)
        items = [by_date[k] for k in sorted(by_date.keys())]
        for row in items:
            row['spend'] = float(f'{row["spend"]:.2f}')
        return {'response_type': 'items', 'payload': items}

    if op == 'account_summary':
        date_range = _safe_date_range(pl.get('date_range'))
        q = f"""
      SELECT
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value
      FROM customer
      WHERE segments.date DURING {date_range}
    """
        rows = _iter_search(client, cid, q)
        total_impressions = 0
        total_clicks = 0
        total_cost_micros = 0
        total_conversions = 0.0
        total_conversion_value = 0.0
        for row in rows:
            met = row.metrics
            total_impressions += int(met.impressions or 0)
            total_clicks += int(met.clicks or 0)
            total_cost_micros += int(met.cost_micros or 0)
            total_conversions += float(met.conversions or 0)
            total_conversion_value += float(met.conversions_value or 0)
        avg_ctr = (total_clicks / total_impressions * 100) if total_impressions > 0 else 0
        avg_cpc = (total_cost_micros / total_clicks) if total_clicks > 0 else 0
        cost_per_conv = (total_cost_micros / total_conversions) if total_conversions > 0 else 0
        total_cost = total_cost_micros / 1_000_000
        avg_cpm = ((total_cost_micros / total_impressions) * 1000 / 1_000_000) if total_impressions > 0 else 0
        roas = (total_conversion_value / total_cost) if total_cost > 0 else 0
        body = {
            'customer_id': cid,
            'date_range': date_range,
            'total_impressions': total_impressions,
            'total_clicks': total_clicks,
            'total_cost': float(f'{total_cost:.2f}'),
            'total_conversions': total_conversions,
            'total_conversion_value': float(f'{total_conversion_value:.2f}'),
            'average_ctr': float(f'{avg_ctr:.2f}'),
            'average_cpc': float(f'{(avg_cpc / 1_000_000):.4f}'),
            'average_cpm': float(f'{avg_cpm:.4f}'),
            'cost_per_conversion': float(f'{(cost_per_conv / 1_000_000):.2f}'),
            'roas': float(f'{roas:.2f}') if roas else 0,
        }
        return {'response_type': 'object', 'payload': body}

    if op == 'gaql':
        raw_q = pl.get('query')
        if not raw_q or not str(raw_q).strip():
            raise ValueError('query is required')
        q = preprocess_gaql(str(raw_q))
        rows = _iter_search(client, cid, q)
        if MessageToDict is None:
            raise RuntimeError('google.protobuf not available')
        items = []
        for row in rows:
            pb = getattr(row, '_pb', None)
            if pb is not None:
                items.append(MessageToDict(pb, preserving_proto_field_name=True))
            else:
                items.append({'error': 'row_to_dict_unsupported'})
        return {'response_type': 'items', 'payload': items}

    raise ValueError(f'Unknown reporting operation: {operation}')
