"""Shared helpers for Google Ads full-publish orchestrators."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from .criteria import create_geo_targeting
from .utils import enum_value


def budget_amount_micros(budget: Optional[dict]) -> int:
    amount = float((budget or {}).get('amount') or 10)
    return int(round(amount * 1_000_000))


def create_dedicated_budget(
    client: Any,
    customer_id: str,
    *,
    name: str,
    budget: Optional[dict],
) -> str:
    """CampaignBudgetService.mutateCampaignBudgets — returns budget resource name."""
    budget_svc = client.get_service('CampaignBudgetService')
    budget_op = client.get_type('CampaignBudgetOperation')
    b = budget_op.create
    b.name = f'{name} Budget'
    b.amount_micros = budget_amount_micros(budget)
    b.delivery_method = enum_value(client, 'BudgetDeliveryMethodEnum', 'STANDARD')
    b.explicitly_shared = False
    br = budget_svc.mutate_campaign_budgets(customer_id=customer_id, operations=[budget_op])
    return br.results[0].resource_name


def apply_eu_political_flag(campaign: Any, client: Any) -> None:
    if hasattr(campaign, 'contains_eu_political_advertising'):
        campaign.contains_eu_political_advertising = enum_value(
            client,
            'EuPoliticalAdvertisingStatusEnum',
            'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
        )


def geo_ids_from_payload(payload: dict) -> List[int]:
    targeting = payload.get('targeting') or {}
    raw = (
        payload.get('geo_target_constant_ids')
        or targeting.get('geo_target_constant_ids')
        or targeting.get('geo_ids')
        or []
    )
    if not isinstance(raw, list):
        return []
    out: List[int] = []
    for x in raw:
        try:
            out.append(int(x))
        except (TypeError, ValueError):
            continue
    return out


def apply_geo_targeting_if_present(
    gcfg: dict,
    *,
    customer_id: str,
    campaign_resource_name: str,
    payload: dict,
) -> None:
    geo_ids = geo_ids_from_payload(payload)
    if not geo_ids:
        return
    out = create_geo_targeting(
        gcfg,
        customer_id=customer_id,
        campaign_resource_name=campaign_resource_name,
        geo_target_constant_ids=geo_ids,
    )
    if not out.get('ok'):
        raise ValueError(out.get('error') or 'google_create_geo_targeting failed')


def creatives_dict(payload: dict) -> dict:
    return dict(payload.get('creatives') or {})


def final_url_from(payload: dict, creatives: Optional[dict] = None) -> str:
    c = creatives if creatives is not None else creatives_dict(payload)
    return str(
        payload.get('final_url')
        or c.get('link_url')
        or c.get('final_url')
        or ''
    ).strip()


def text_lines(value: Any) -> List[str]:
    if isinstance(value, list):
        return [str(x).strip() for x in value if x and str(x).strip()]
    if isinstance(value, str):
        return [ln.strip() for ln in value.replace(',', '\n').split('\n') if ln.strip()]
    return []


def feed_label_from_payload(payload: dict) -> str:
    """Shopping feed_label — replaces deprecated sales_country (Google Ads API)."""
    shopping = payload.get('shopping') if isinstance(payload.get('shopping'), dict) else {}
    raw = (
        payload.get('feed_label')
        or shopping.get('feed_label')
        or payload.get('sales_country')
        or shopping.get('sales_country')
        or ''
    )
    return str(raw).strip()


def target_cpa_micros_from_payload(payload: dict, *, default_micros: int = 1_000_000) -> int:
    """Default $1 target CPA for App / Video action campaigns when not specified."""
    for key in ('target_cpa_micros', 'target_cpa'):
        val = payload.get(key)
        if val is None:
            continue
        try:
            micros = int(val)
            if micros > 0:
                return micros
        except (TypeError, ValueError):
            pass
        try:
            return int(round(float(val) * 1_000_000))
        except (TypeError, ValueError):
            continue
    return default_micros


def resolve_logo_asset(
    gcfg: dict,
    customer_id: str,
    payload: dict,
    creatives: Optional[dict] = None,
    *,
    upload_name: str = 'logo',
) -> str:
    """Upload or resolve logo image asset resource name (required for VideoResponsive / PMax)."""
    from .assets import upload_image_asset

    c = creatives if creatives is not None else creatives_dict(payload)
    existing = c.get('logo_image_assets') or c.get('logo_images') or payload.get('logo_image_assets') or []
    if isinstance(existing, list) and existing and str(existing[0]).startswith('customers/'):
        return str(existing[0])
    raw_list = c.get('logo_image_data') or payload.get('logo_image_data') or []
    if not isinstance(raw_list, list):
        raw_list = [raw_list] if raw_list else []
    if not raw_list:
        raise ValueError('logo_image_data or logo_image_assets is required')
    up = upload_image_asset(
        gcfg,
        customer_id=customer_id,
        image_data=str(raw_list[0]),
        name=upload_name,
    )
    if not up.get('ok'):
        raise ValueError(up.get('error') or 'logo upload failed')
    return str(up['asset_resource_name'])

