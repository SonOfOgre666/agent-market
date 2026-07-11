"""Campaign language targeting."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from .api import GoogleAdsException, digits_customer_id, format_google_ads_exception, load_client
from .criteria import resolve_campaign_resource_name

# Common language constant IDs (Google Ads languageConstants/{id})
_LANGUAGE_ALIASES: Dict[str, str] = {
    'english': '1000',
    'en': '1000',
    'german': '1001',
    'de': '1001',
    'french': '1002',
    'fr': '1002',
    'spanish': '1003',
    'es': '1003',
    'italian': '1004',
    'it': '1004',
    'japanese': '1005',
    'ja': '1005',
    'dutch': '1010',
    'nl': '1010',
    'portuguese': '1014',
    'pt': '1014',
    'arabic': '1019',
    'ar': '1019',
}


def _normalize_language_ids(raw: List[Any]) -> List[str]:
    out: List[str] = []
    for item in raw or []:
        if item is None:
            continue
        s = str(item).strip()
        if not s:
            continue
        if s.isdigit():
            out.append(s)
            continue
        key = s.lower()
        if key in _LANGUAGE_ALIASES:
            out.append(_LANGUAGE_ALIASES[key])
            continue
        if key.startswith('languageconstants/'):
            out.append(key.split('/')[-1])
            continue
    return out


def create_language_targeting(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    campaign_resource_name: Optional[str] = None,
    platform_campaign_id: Optional[str] = None,
    language_ids: Optional[List[Any]] = None,
    languages: Optional[List[Any]] = None,
) -> Dict[str, Any]:
    """CampaignCriterionService — positive language criteria."""
    cid = digits_customer_id(customer_id)
    camp_rn = resolve_campaign_resource_name(
        google_ads_client_config,
        cid,
        campaign_resource_name,
        platform_campaign_id,
    )
    ids = _normalize_language_ids(list(language_ids or languages or []))
    if not cid or not camp_rn:
        return {'ok': False, 'error': 'customer_id and campaign resource name are required'}
    if not ids:
        return {'ok': False, 'error': 'language_ids or languages is required'}

    client = load_client(google_ads_client_config)
    svc = client.get_service('CampaignCriterionService')
    ops = []
    for lang_id in ids:
        op = client.get_type('CampaignCriterionOperation')
        crit = op.create
        crit.campaign = camp_rn
        crit.language.language_constant = f'languageConstants/{lang_id}'
        ops.append(op)

    try:
        resp = svc.mutate_campaign_criteria(customer_id=cid, operations=ops)
    except GoogleAdsException as exc:  # type: ignore[misc]
        return {'ok': False, 'error': format_google_ads_exception(exc)}

    names = [r.resource_name for r in resp.results]
    return {'ok': True, 'resource_names': names, 'language_ids': ids}
