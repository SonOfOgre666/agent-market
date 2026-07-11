"""Google Ads keyword criteria mutations (reference criterion.create_keywords)."""

from __future__ import annotations

from typing import Any, Dict, List, Union

from .utils import client_enum, enum_value, resolve_enum

_MATCH_TYPES = {'BROAD', 'PHRASE', 'EXACT'}

KeywordInput = Union[str, Dict[str, Any]]


def normalize_keyword_entries(
    keywords: List[KeywordInput] | None,
    *,
    default_match_type: str = 'BROAD',
) -> List[Dict[str, str]]:
    """Normalize strings or {text, match_type} dicts (reference create_keywords)."""
    out: List[Dict[str, str]] = []
    def_mt = (default_match_type or 'BROAD').upper()
    if def_mt not in _MATCH_TYPES:
        def_mt = 'BROAD'

    for item in keywords or []:
        if isinstance(item, dict):
            text = str(item.get('text') or item.get('keyword') or '').strip()
            mt = str(item.get('match_type') or def_mt).upper()
        else:
            text = str(item or '').strip()
            mt = def_mt
        if not text:
            continue
        if mt not in _MATCH_TYPES:
            mt = def_mt
        out.append({'text': text, 'match_type': mt})
    return out


def add_keywords_to_ad_group(
    client: Any,
    customer_id: str,
    *,
    ad_group_resource_name: str,
    keywords: List[KeywordInput] | None = None,
    keyword_entries: List[Dict[str, str]] | None = None,
    match_type: str = 'BROAD',
    max_keywords: int = 20,
) -> Dict[str, Any]:
    """Add keyword criteria to an ad group."""
    cid = ''.join(c for c in str(customer_id or '') if c.isdigit())
    if not cid or not ad_group_resource_name:
        return {'ok': False, 'error': 'customer_id and ad_group_resource_name are required'}

    entries = keyword_entries if keyword_entries is not None else normalize_keyword_entries(
        keywords,
        default_match_type=match_type,
    )
    entries = entries[:max_keywords]

    enum_cls = client_enum(client, 'KeywordMatchTypeEnum')
    crit_svc = client.get_service('AdGroupCriterionService')
    ops = []
    added_detail: List[Dict[str, str]] = []

    for entry in entries:
        text = entry['text']
        mt_enum = resolve_enum(enum_cls, entry['match_type'], 'match_type')
        op = client.get_type('AdGroupCriterionOperation')
        crit = op.create
        crit.ad_group = ad_group_resource_name
        crit.status = enum_value(client, 'AdGroupCriterionStatusEnum', 'ENABLED')
        crit.keyword.text = text
        crit.keyword.match_type = mt_enum
        ops.append(op)
        added_detail.append({'text': text, 'match_type': entry['match_type']})

    if not ops:
        return {'ok': True, 'added': 0, 'keywords': [], 'keyword_entries': []}

    resp = crit_svc.mutate_ad_group_criteria(customer_id=cid, operations=ops)
    resource_names = [r.resource_name for r in resp.results]
    return {
        'ok': True,
        'added': len(added_detail),
        'keywords': [e['text'] for e in added_detail],
        'keyword_entries': added_detail,
        'resource_names': resource_names,
    }


def _criterion_path(client: Any, customer_id: str, ad_group_id: str, criterion_id: str) -> str:
    ag = ''.join(c for c in str(ad_group_id) if c.isdigit())
    crit = ''.join(c for c in str(criterion_id) if c.isdigit())
    return client.get_service('AdGroupCriterionService').ad_group_criterion_path(customer_id, ag, crit)


def list_keywords(
    client: Any,
    customer_id: str,
    *,
    campaign_id: str | None = None,
    ad_group_id: str | None = None,
    limit: int = 200,
) -> Dict[str, Any]:
    """List keyword criteria (reference list_keywords)."""
    cid = ''.join(c for c in str(customer_id) if c.isdigit())
    camp = ''.join(c for c in str(campaign_id or '') if c.isdigit()) if campaign_id else ''
    agid = ''.join(c for c in str(ad_group_id or '') if c.isdigit()) if ad_group_id else ''
    q = """
      SELECT
        ad_group_criterion.criterion_id,
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.status,
        ad_group_criterion.cpc_bid_micros,
        ad_group.id, ad_group.name,
        campaign.id, campaign.name
      FROM keyword_view
      WHERE ad_group_criterion.status != 'REMOVED'
    """
    if camp:
        q += f' AND campaign.id = {camp}'
    if agid:
        q += f' AND ad_group.id = {agid}'
    q += ' ORDER BY ad_group_criterion.keyword.text LIMIT 500'
    ga = client.get_service('GoogleAdsService')
    items: List[Dict[str, Any]] = []
    for row in ga.search(customer_id=cid, query=q):
        crit = row.ad_group_criterion
        kw = crit.keyword
        items.append({
            'keyword_id': str(crit.criterion_id),
            'text': str(kw.text or ''),
            'match_type': str(kw.match_type.name if hasattr(kw.match_type, 'name') else kw.match_type),
            'status': str(crit.status.name if hasattr(crit.status, 'name') else crit.status),
            'cpc_bid_micros': int(crit.cpc_bid_micros or 0),
            'ad_group_id': str(row.ad_group.id),
            'ad_group_name': row.ad_group.name,
            'campaign_id': str(row.campaign.id),
        })
        if len(items) >= max(1, min(int(limit or 200), 500)):
            break
    return {'ok': True, 'data': items, 'count': len(items)}


def update_keyword_bid(
    client: Any,
    customer_id: str,
    *,
    ad_group_id: str,
    keyword_id: str,
    cpc_bid_micros: int,
) -> Dict[str, Any]:
    from google.protobuf import field_mask_pb2

    svc = client.get_service('AdGroupCriterionService')
    op = client.get_type('AdGroupCriterionOperation')
    c = op.update
    c.resource_name = _criterion_path(client, customer_id, ad_group_id, keyword_id)
    c.cpc_bid_micros = int(cpc_bid_micros)
    op.update_mask.CopyFrom(field_mask_pb2.FieldMask(paths=['cpc_bid_micros']))
    resp = svc.mutate_ad_group_criteria(customer_id=customer_id, operations=[op])
    return {'ok': True, 'resource_name': resp.results[0].resource_name, 'cpc_bid_micros': int(cpc_bid_micros)}


def set_keyword_status(
    client: Any,
    customer_id: str,
    *,
    ad_group_id: str,
    keyword_id: str,
    status: str,
) -> Dict[str, Any]:
    from google.protobuf import field_mask_pb2

    svc = client.get_service('AdGroupCriterionService')
    op = client.get_type('AdGroupCriterionOperation')
    c = op.update
    c.resource_name = _criterion_path(client, customer_id, ad_group_id, keyword_id)
    c.status = enum_value(client, 'AdGroupCriterionStatusEnum', status.upper())
    op.update_mask.CopyFrom(field_mask_pb2.FieldMask(paths=['status']))
    resp = svc.mutate_ad_group_criteria(customer_id=customer_id, operations=[op])
    return {'ok': True, 'resource_name': resp.results[0].resource_name, 'status': status.upper()}


def remove_keyword(
    client: Any,
    customer_id: str,
    *,
    ad_group_id: str,
    keyword_id: str,
) -> Dict[str, Any]:
    svc = client.get_service('AdGroupCriterionService')
    op = client.get_type('AdGroupCriterionOperation')
    op.remove = _criterion_path(client, customer_id, ad_group_id, keyword_id)
    resp = svc.mutate_ad_group_criteria(customer_id=customer_id, operations=[op])
    return {'ok': True, 'keyword_id': str(keyword_id), 'resource_name': resp.results[0].resource_name}
