"""Google Ads campaign mutations and sync reads."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from .api import GoogleAdsException, GoogleAdsLibraryMissing, GoogleAdsClient, digits_customer_id, load_client
from .keywords import add_keywords_to_ad_group, normalize_keyword_entries
from .utils import (
    client_enum,
    enum_name,
    enum_value,
    map_campaign_status,
    map_channel_type,
    resolve_channel_enum,
    resolve_enum,
)

logger = logging.getLogger(__name__)


_DATE_ONLY = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def _parse_schedule_datetime(
    value,
    *,
    default_now: bool = False,
    end_of_day: bool = False,
) -> Optional[datetime]:
    if value is None or value == '':
        return datetime.now(timezone.utc) if default_now else None
    if isinstance(value, datetime):
        dt = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
        return dt
    if isinstance(value, str):
        s = value.strip()
        if _DATE_ONLY.match(s):
            y, m, d = (int(s[0:4]), int(s[5:7]), int(s[8:10]))
            if end_of_day:
                return datetime(y, m, d, 23, 59, 59, tzinfo=timezone.utc)
            return datetime(y, m, d, 0, 0, 0, tzinfo=timezone.utc)
        dt = datetime.fromisoformat(s.replace('Z', '+00:00'))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    return datetime.now(timezone.utc) if default_now else None


def _search_uses_manual_cpc(cpc_bid_micros: Optional[int]) -> bool:
    try:
        return cpc_bid_micros is not None and int(cpc_bid_micros) > 0
    except (TypeError, ValueError):
        return False


def _apply_search_bidding(campaign: Any, client: Any, cpc_bid_micros: Optional[int]) -> bool:
    """
    TargetSpend (default) cannot be combined with ad-group cpc_bid_micros — Google returns
    OPERATION_NOT_PERMITTED_FOR_CONTEXT. Use ManualCpc when the wizard sets a CPC bid.
    """
    if _search_uses_manual_cpc(cpc_bid_micros):
        if hasattr(campaign, 'manual_cpc'):
            campaign.manual_cpc = client.get_type('ManualCpc')
            return True
        campaign.maximize_clicks = client.get_type('MaximizeClicks')
        return True
    campaign.target_spend = client.get_type('TargetSpend')
    return False


def _resolve_schedule_tz(timezone_name: str | None) -> ZoneInfo | timezone:
    if timezone_name:
        try:
            return ZoneInfo(str(timezone_name).strip())
        except Exception:
            logger.warning(
                '[connector.google_ads] Unknown schedule timezone %r; using UTC',
                timezone_name,
            )
    return timezone.utc


def _parse_schedule_ymd(value) -> Tuple[int, int, int] | None:
    if value is None or value == '':
        return None
    if isinstance(value, datetime):
        return value.year, value.month, value.day
    s = str(value).strip()
    if not s:
        return None
    if _DATE_ONLY.match(s):
        return int(s[0:4]), int(s[5:7]), int(s[8:10])
    if len(s) >= 10 and s[4] == '-' and s[7] == '-':
        try:
            return int(s[0:4]), int(s[5:7]), int(s[8:10])
        except ValueError:
            return None
    if len(s) == 8 and s.isdigit():
        return int(s[0:4]), int(s[4:6]), int(s[6:8])
    try:
        dt = datetime.fromisoformat(s.replace('Z', '+00:00'))
        return dt.year, dt.month, dt.day
    except ValueError:
        return None


def _schedule_now(tz: ZoneInfo | timezone) -> datetime:
    return datetime.now(tz)


def _apply_campaign_schedule(
    campaign: Any,
    start_date,
    end_date,
    *,
    schedule_timezone: str | None = None,
) -> None:
    """
    Google Ads API v23+ uses start_date_time / end_date_time in the customer's timezone.
    Start must use 00:00:00; end must use 23:59:59 for daily granularity.
    If the requested start day has already begun locally, omit start_date_time so the
    campaign can begin immediately when enabled.
    """
    tz = _resolve_schedule_tz(schedule_timezone)
    now_local = _schedule_now(tz)
    today_local = now_local.date()

    start_ymd = _parse_schedule_ymd(start_date)
    end_ymd = _parse_schedule_ymd(end_date)

    start_dt_local: datetime | None = None
    if start_ymd:
        y, m, d = start_ymd
        candidate = datetime(y, m, d, 0, 0, 0, tzinfo=tz)
        if candidate.date() < today_local:
            candidate = datetime.combine(today_local, datetime.min.time(), tzinfo=tz)
        if candidate > now_local:
            start_dt_local = candidate

    end_dt_local: datetime | None = None
    if end_ymd:
        y, m, d = end_ymd
        candidate = datetime(y, m, d, 23, 59, 59, tzinfo=tz)
        if candidate.date() >= today_local:
            if start_dt_local and candidate <= start_dt_local:
                end_day = start_dt_local.date() + timedelta(days=1)
                candidate = datetime(end_day.year, end_day.month, end_day.day, 23, 59, 59, tzinfo=tz)
            end_dt_local = candidate

    if start_dt_local:
        formatted = start_dt_local.strftime('%Y-%m-%d %H:%M:%S')
        if hasattr(campaign, 'start_date_time'):
            campaign.start_date_time = formatted
        elif hasattr(campaign, 'start_date'):
            campaign.start_date = start_dt_local.strftime('%Y%m%d')

    if end_dt_local:
        formatted = end_dt_local.strftime('%Y-%m-%d %H:%M:%S')
        if hasattr(campaign, 'end_date_time'):
            campaign.end_date_time = formatted
        elif hasattr(campaign, 'end_date'):
            campaign.end_date = end_dt_local.strftime('%Y%m%d')


def mutate_create_paused_campaign(
    client: Any,
    customer_id: str,
    name: str,
    budget: Optional[dict],
    start_date,
    end_date,
    keywords: List[str],
    ctype: Optional[str],
    creatives: dict,
    *,
    keyword_entries: Optional[List[Dict[str, str]]] = None,
    adgroup_status: str = 'PAUSED',
    cpc_bid_micros: Optional[int] = None,
    schedule_timezone: str | None = None,
) -> Dict[str, Optional[str]]:
    """Create budget + paused campaign + optional ad group / keywords / RSA."""
    daily_budget_micros = int(round((budget or {}).get('amount') or 10) * 1_000_000)
    if (budget or {}).get('type') == 'lifetime':
        logger.warning(
            '[connector.google_ads] Lifetime budget not supported with maximize_clicks bidding — '
            '"%s" will use daily amount %s',
            name,
            (budget or {}).get('amount'),
        )
    channel = map_channel_type(ctype or 'search')
    ch_enum = resolve_channel_enum(client, channel)
    search_enum = enum_value(client, 'AdvertisingChannelTypeEnum', 'SEARCH')
    display_enum = enum_value(client, 'AdvertisingChannelTypeEnum', 'DISPLAY')
    video_enum = enum_value(client, 'AdvertisingChannelTypeEnum', 'VIDEO')
    is_search = ch_enum == search_enum

    budget_svc = client.get_service('CampaignBudgetService')
    budget_op = client.get_type('CampaignBudgetOperation')
    b = budget_op.create
    b.name = f'{name} Budget'
    b.amount_micros = daily_budget_micros
    b.delivery_method = enum_value(client, 'BudgetDeliveryMethodEnum', 'STANDARD')
    b.explicitly_shared = False
    br = budget_svc.mutate_campaign_budgets(customer_id=customer_id, operations=[budget_op])
    budget_rn = br.results[0].resource_name

    camp_svc = client.get_service('CampaignService')
    camp_op = client.get_type('CampaignOperation')
    c = camp_op.create
    c.name = name
    c.advertising_channel_type = ch_enum
    c.status = enum_value(client, 'CampaignStatusEnum', 'PAUSED')
    c.campaign_budget = budget_rn
    if channel == 'performance_max' and hasattr(c, 'advertising_channel_sub_type'):
        try:
            c.advertising_channel_sub_type = enum_value(
                client, 'AdvertisingChannelSubTypeEnum', 'UNSPECIFIED',
            )
        except (AttributeError, ValueError):
            pass
    if not is_search or start_date or end_date:
        _apply_campaign_schedule(
            c,
            start_date,
            end_date,
            schedule_timezone=schedule_timezone,
        )
    c.network_settings.target_google_search = is_search
    c.network_settings.target_search_network = is_search
    c.network_settings.target_content_network = ch_enum == display_enum
    c.network_settings.target_partner_search_network = False if is_search else False
    ad_group_cpc: Optional[int] = None
    if ch_enum == video_enum:
        c.target_cpm = client.get_type('TargetCpm')
    elif is_search:
        if _apply_search_bidding(c, client, cpc_bid_micros):
            ad_group_cpc = int(cpc_bid_micros)  # type: ignore[arg-type]
    else:
        try:
            c.manual_cpc = client.get_type('ManualCpc')
        except (AttributeError, ValueError):
            c.maximize_clicks = client.get_type('MaximizeClicks')
        if _search_uses_manual_cpc(cpc_bid_micros):
            ad_group_cpc = int(cpc_bid_micros)  # type: ignore[arg-type]
    if hasattr(c, 'contains_eu_political_advertising'):
        c.contains_eu_political_advertising = enum_value(
            client,
            'EuPoliticalAdvertisingStatusEnum',
            'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
        )
    try:
        cr = camp_svc.mutate_campaigns(customer_id=customer_id, operations=[camp_op])
    except GoogleAdsException as exc:  # type: ignore[misc]
        from .api import format_google_ads_exception

        raise ValueError(format_google_ads_exception(exc)) from exc
    campaign_rn = cr.results[0].resource_name
    campaign_id = campaign_rn.split('/')[-1]

    from .adgroups import create_paused_ad_group
    from .ads import create_responsive_search_ad

    ad_group_rn = None
    channel_name = channel
    skip_ad_group = channel in ('video', 'performance_max')
    if not skip_ad_group:
        ag_out = create_paused_ad_group(
            client,
            customer_id,
            campaign_resource_name=campaign_rn,
            name=f'{name} — Ad Group',
            channel=channel_name,
            status=adgroup_status,
            cpc_bid_micros=ad_group_cpc,
        )
        ad_group_rn = ag_out['ad_group_resource_name']

        entries = keyword_entries if keyword_entries else normalize_keyword_entries(keywords)
        if entries and is_search:
            add_keywords_to_ad_group(
                client,
                customer_id,
                ad_group_resource_name=ad_group_rn,
                keyword_entries=entries,
            )

    rsa_headlines = [h for h in (creatives.get('headlines') or []) if h and str(h).strip()]
    rsa_descriptions = [d for d in (creatives.get('descriptions') or []) if d and str(d).strip()]
    final_url = (creatives.get('link_url') or '').strip()
    ad_id = None
    if is_search and ad_group_rn and (rsa_headlines or rsa_descriptions or final_url):
        rsa_out = create_responsive_search_ad(
            client,
            customer_id,
            ad_group_resource_name=ad_group_rn,
            headlines=rsa_headlines,
            descriptions=rsa_descriptions,
            final_url=final_url,
            path1=str(creatives.get('path1') or ''),
            path2=str(creatives.get('path2') or ''),
            status=str(creatives.get('ad_status') or 'PAUSED'),
        )
        if rsa_out.get('skipped') or rsa_out.get('error'):
            raise ValueError(rsa_out.get('reason') or rsa_out.get('error') or 'RSA creation failed')
        ad_id = rsa_out.get('platform_ad_id')

    return {
        'platform_campaign_id': campaign_id,
        'platform_ad_set_id': ad_group_rn.split('/')[-1] if ad_group_rn else None,
        'platform_ad_id': ad_id,
    }


def execute_publish_campaign_mutations(
    *,
    google_ads_client_config: Dict[str, Any],
    customer_id: str,
    name: str,
    budget: Optional[dict],
    start_date,
    end_date,
    keywords: List[str],
    ctype: Optional[str],
    creatives: dict,
    keyword_entries: Optional[List[Dict[str, str]]] = None,
    adgroup_status: str = 'PAUSED',
    cpc_bid_micros: Optional[int] = None,
    schedule_timezone: str | None = None,
) -> Dict[str, Optional[str]]:
    client = load_client(google_ads_client_config)
    return mutate_create_paused_campaign(
        client,
        customer_id,
        name,
        budget,
        start_date,
        end_date,
        keywords,
        ctype,
        creatives,
        keyword_entries=keyword_entries,
        adgroup_status=adgroup_status,
        cpc_bid_micros=cpc_bid_micros,
        schedule_timezone=schedule_timezone,
    )


def fetch_campaign_sync_rows(gcfg: Dict[str, Any], customer_id: str) -> List[Dict[str, Any]]:
    if GoogleAdsClient is None:
        return []
    cid = digits_customer_id(customer_id)
    if not cid:
        return []
    try:
        client = load_client(gcfg)
    except Exception as exc:
        logger.warning('[connector.google_ads] load_client failed: %s', exc)
        return []

    ga_service = client.get_service('GoogleAdsService')
    query = """
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign.start_date,
        campaign.end_date,
        campaign.start_date_time,
        campaign.end_date_time,
        campaign_budget.amount_micros,
        customer.currency_code,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value,
        metrics.ctr
      FROM campaign
      WHERE campaign.status != 'REMOVED'
      ORDER BY campaign.name
    """

    out: List[Dict[str, Any]] = []
    try:
        if hasattr(ga_service, 'search'):
            rows_iter = ga_service.search(customer_id=cid, query=query)
        else:
            rows_iter = []
            stream = ga_service.search_stream(customer_id=cid, query=query)
            for batch in stream:
                rows_iter.extend(list(batch.results))

        for row in rows_iter:
            c = row.campaign
            cb = row.campaign_budget
            cust = row.customer
            met = row.metrics
            budget_amount = (cb.amount_micros / 1_000_000) if cb and cb.amount_micros else 0
            spend = (met.cost_micros / 1_000_000) if met and met.cost_micros else 0
            currency = getattr(cust, 'currency_code', None) or 'USD'
            clicks = int(met.clicks or 0) if met else 0
            conversion_value = float(met.conversions_value or 0) if met else 0
            out.append(
                {
                    'google_campaign_id': str(c.id),
                    'name': c.name or '',
                    'platform': 'google_ads',
                    'type': map_channel_type(enum_name(c.advertising_channel_type)),
                    'status': map_campaign_status(enum_name(c.status)),
                    'budget': {'amount': float(budget_amount), 'currency': currency, 'type': 'daily'},
                    'start_date': (
                        getattr(c, 'start_date_time', None)
                        or c.start_date
                        or None
                    ),
                    'end_date': (
                        getattr(c, 'end_date_time', None)
                        or c.end_date
                        or None
                    ),
                    'metrics': {
                        'impressions': int(met.impressions or 0) if met else 0,
                        'clicks': clicks,
                        'spend': float(f'{spend:.2f}'),
                        'conversions': float(met.conversions or 0) if met else 0,
                        'conversion_value': float(f'{conversion_value:.2f}'),
                        'ctr': float(met.ctr or 0) if met else 0,
                        'cpc': float(f'{(spend / clicks):.4f}') if clicks else 0,
                    },
                }
            )
    except GoogleAdsException as exc:  # type: ignore[misc]
        logger.warning('[connector.google_ads] search failed: %s', exc)
        return []
    except Exception as exc:
        logger.warning('[connector.google_ads] search error: %s', exc)
        return []

    return out


def mutate_update_campaign_status(
    google_ads_client_config: Dict[str, Any],
    customer_id: str,
    platform_campaign_id: str,
    status: str,
) -> None:
    if GoogleAdsClient is None:
        raise GoogleAdsLibraryMissing()
    cid = digits_customer_id(customer_id)
    camp_id = digits_customer_id(platform_campaign_id) or str(platform_campaign_id or '').strip()
    if not cid or not camp_id:
        raise ValueError('customer_id and platform_campaign_id required')

    client = load_client(google_ads_client_config)
    cmap = {'active': 'ENABLED', 'paused': 'PAUSED', 'ended': 'REMOVED'}
    key = (status or '').lower().strip()
    google_status = cmap.get(key, 'PAUSED')
    status_enum = enum_value(client, 'CampaignStatusEnum', google_status)

    svc = client.get_service('CampaignService')
    op = client.get_type('CampaignOperation')
    camp = op.update
    camp.resource_name = svc.campaign_path(cid, camp_id)
    camp.status = status_enum

    from google.protobuf import field_mask_pb2

    op.update_mask.CopyFrom(field_mask_pb2.FieldMask(paths=['status']))
    svc.mutate_campaigns(customer_id=cid, operations=[op])
    logger.info('[connector.google_ads] campaign %s status → %s', camp_id, google_status)


def update_campaign_status(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    platform_campaign_id: str,
    status: str,
) -> Dict[str, Any]:
    """Agent-callable wrapper for mutate_update_campaign_status (reference update_campaign_status)."""
    mutate_update_campaign_status(
        google_ads_client_config,
        customer_id,
        platform_campaign_id,
        status,
    )
    return {
        'ok': True,
        'platform_campaign_id': str(platform_campaign_id),
        'status': status,
    }


def create_typed_campaign(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    name: str,
    budget_resource_name: str,
    campaign_type: str = 'SEARCH',
    status: str = 'PAUSED',
    start_date=None,
    end_date=None,
    schedule_timezone: str | None = None,
    target_google_search: Optional[bool] = None,
    target_search_network: Optional[bool] = None,
    target_content_network: Optional[bool] = None,
) -> Dict[str, Any]:
    """Create campaign on existing budget — all channel types (reference create_campaign / create_search_campaign)."""
    if GoogleAdsClient is None:
        raise GoogleAdsLibraryMissing()

    cid = digits_customer_id(customer_id)
    if not cid:
        return {'ok': False, 'error': 'customer_id is required'}
    camp_name = (name or '').strip()
    budget_rn = (budget_resource_name or '').strip()
    if not camp_name or not budget_rn:
        return {'ok': False, 'error': 'name and budget_resource_name are required'}

    channel = map_channel_type(campaign_type)
    client = load_client(google_ads_client_config)
    svc = client.get_service('CampaignService')
    op = client.get_type('CampaignOperation')
    c = op.create
    c.name = camp_name
    c.campaign_budget = budget_rn
    c.status = resolve_enum(client_enum(client, 'CampaignStatusEnum'), status, 'status')
    ch_enum = resolve_channel_enum(client, channel)
    c.advertising_channel_type = ch_enum
    search_enum = enum_value(client, 'AdvertisingChannelTypeEnum', 'SEARCH')
    display_enum = enum_value(client, 'AdvertisingChannelTypeEnum', 'DISPLAY')
    video_enum = enum_value(client, 'AdvertisingChannelTypeEnum', 'VIDEO')
    is_search = ch_enum == search_enum

    if is_search:
        c.target_spend = client.get_type('TargetSpend')
    elif ch_enum == video_enum:
        c.target_cpm = client.get_type('TargetCpm')
    else:
        try:
            c.manual_cpc = client.get_type('ManualCpc')
        except (AttributeError, ValueError):
            c.maximize_clicks = client.get_type('MaximizeClicks')

    if hasattr(c, 'contains_eu_political_advertising'):
        c.contains_eu_political_advertising = enum_value(
            client,
            'EuPoliticalAdvertisingStatusEnum',
            'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
        )

    if not is_search:
        _apply_campaign_schedule(
            c,
            start_date,
            end_date,
            schedule_timezone=schedule_timezone,
        )

    tg = target_google_search if target_google_search is not None else is_search
    ts = target_search_network if target_search_network is not None else is_search
    tc = target_content_network if target_content_network is not None else (ch_enum == display_enum)
    c.network_settings.target_google_search = bool(tg)
    c.network_settings.target_search_network = bool(ts)
    c.network_settings.target_content_network = bool(tc)
    c.network_settings.target_partner_search_network = False

    try:
        resp = svc.mutate_campaigns(customer_id=cid, operations=[op])
    except GoogleAdsException as exc:  # type: ignore[misc]
        from .api import format_google_ads_exception

        return {'ok': False, 'error': format_google_ads_exception(exc)}

    rn = resp.results[0].resource_name
    return {
        'ok': True,
        'resource_name': rn,
        'campaign_resource_name': rn,
        'platform_campaign_id': rn.split('/')[-1],
        'campaign_type': channel,
    }


def create_search_campaign(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    name: str,
    budget_resource_name: str,
    status: str = 'PAUSED',
    target_google_search: bool = True,
    target_search_network: bool = False,
    target_content_network: bool = False,
) -> Dict[str, Any]:
    """Search-only alias for create_typed_campaign."""
    return create_typed_campaign(
        google_ads_client_config,
        customer_id=customer_id,
        name=name,
        budget_resource_name=budget_resource_name,
        campaign_type='SEARCH',
        status=status,
        target_google_search=target_google_search,
        target_search_network=target_search_network,
        target_content_network=target_content_network,
    )


def create_campaign_with_budget(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    name: str,
    budget_amount: float,
    campaign_type: str = 'SEARCH',
    status: str = 'PAUSED',
    start_date=None,
    end_date=None,
) -> Dict[str, Any]:
    """Reference create_campaign: budget + typed campaign in one call."""
    from .budgets import create_campaign_budget

    cid = digits_customer_id(customer_id)
    if not cid or not (name or '').strip():
        return {'ok': False, 'error': 'customer_id and name are required'}
    amount = float(budget_amount or 0)
    if amount < 1:
        return {'ok': False, 'error': 'budget_amount must be at least 1'}

    budget_out = create_campaign_budget(
        google_ads_client_config,
        customer_id=cid,
        name=f'{name.strip()} — Budget',
        amount_micros=int(amount * 1_000_000),
    )
    if not budget_out.get('ok'):
        return budget_out

    return create_typed_campaign(
        google_ads_client_config,
        customer_id=cid,
        name=name.strip(),
        budget_resource_name=budget_out['budget_resource_name'],
        campaign_type=campaign_type,
        status=status,
        start_date=start_date,
        end_date=end_date,
    )


def update_campaign_geo_target_type(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    campaign_resource_name: str,
    positive_geo_target_type: Optional[str] = None,
    negative_geo_target_type: Optional[str] = None,
) -> Dict[str, Any]:
    """Update campaign geo targeting mode (reference update_campaign_geo_target_type)."""
    if GoogleAdsClient is None:
        raise GoogleAdsLibraryMissing()

    cid = digits_customer_id(customer_id)
    camp_rn = (campaign_resource_name or '').strip()
    if not cid or not camp_rn:
        return {'ok': False, 'error': 'customer_id and campaign_resource_name are required'}
    if not positive_geo_target_type and not negative_geo_target_type:
        return {
            'ok': False,
            'error': 'At least one of positive_geo_target_type or negative_geo_target_type is required',
        }

    from google.protobuf import field_mask_pb2

    client = load_client(google_ads_client_config)
    svc = client.get_service('CampaignService')
    op = client.get_type('CampaignOperation')
    c = op.update
    c.resource_name = camp_rn
    paths = []

    if positive_geo_target_type:
        c.geo_target_type_setting.positive_geo_target_type = resolve_enum(
            client_enum(client, 'PositiveGeoTargetTypeEnum'),
            positive_geo_target_type,
            'positive_geo_target_type',
        )
        paths.append('geo_target_type_setting.positive_geo_target_type')

    if negative_geo_target_type:
        c.geo_target_type_setting.negative_geo_target_type = resolve_enum(
            client_enum(client, 'NegativeGeoTargetTypeEnum'),
            negative_geo_target_type,
            'negative_geo_target_type',
        )
        paths.append('geo_target_type_setting.negative_geo_target_type')

    op.update_mask.CopyFrom(field_mask_pb2.FieldMask(paths=paths))
    resp = svc.mutate_campaigns(customer_id=cid, operations=[op])
    rn = resp.results[0].resource_name
    return {'ok': True, 'resource_name': rn, 'campaign_resource_name': rn}


def list_campaigns(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    limit: int = 50,
) -> Dict[str, Any]:
    """List campaigns for an account (sync read, reference-style list)."""
    rows = fetch_campaign_sync_rows(google_ads_client_config, customer_id)
    capped = rows[: max(1, min(int(limit or 50), 500))]
    return {'ok': True, 'data': capped, 'count': len(capped)}


def get_campaign(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    campaign_id: str,
) -> Dict[str, Any]:
    """Fetch one campaign by id (reference get_campaign parity with meta_get_campaign)."""
    if GoogleAdsClient is None:
        return {'ok': False, 'error': 'google-ads library not installed'}
    cid = digits_customer_id(customer_id)
    camp = ''.join(c for c in str(campaign_id or '') if c.isdigit())
    if not cid or not camp:
        return {'ok': False, 'error': 'customer_id and campaign_id are required'}
    try:
        client = load_client(google_ads_client_config)
    except Exception as exc:
        return {'ok': False, 'error': str(exc)}

    ga = client.get_service('GoogleAdsService')
    query = f"""
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign.resource_name,
        campaign.start_date,
        campaign.end_date,
        campaign_budget.amount_micros,
        customer.currency_code
      FROM campaign
      WHERE campaign.id = {camp}
        AND campaign.status != 'REMOVED'
      LIMIT 1
    """
    try:
        rows = list(ga.search(customer_id=cid, query=query))
    except GoogleAdsException as exc:  # type: ignore[misc]
        parts = [getattr(e, 'message', str(e)) for e in getattr(getattr(exc, 'failure', None), 'errors', []) or []]
        return {'ok': False, 'error': parts[0] if parts else str(exc)}
    except Exception as exc:
        return {'ok': False, 'error': str(exc)}

    if not rows:
        return {'ok': False, 'error': f'Campaign {camp} not found'}

    row = rows[0]
    c = row.campaign
    cb = row.campaign_budget
    cust = row.customer
    budget_amount = (cb.amount_micros / 1_000_000) if cb and cb.amount_micros else 0
    currency = getattr(cust, 'currency_code', None) or 'USD'
    return {
        'ok': True,
        'campaign': {
            'google_campaign_id': str(c.id),
            'platform_campaign_id': str(c.id),
            'name': c.name or '',
            'status': map_campaign_status(enum_name(c.status)),
            'type': map_channel_type(enum_name(c.advertising_channel_type)),
            'resource_name': c.resource_name,
            'budget': {'amount': float(budget_amount), 'currency': currency, 'type': 'daily'},
            'start_date': getattr(c, 'start_date', None),
            'end_date': getattr(c, 'end_date', None),
        },
    }


def delete_campaign(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    campaign_id: str,
) -> Dict[str, Any]:
    """Remove campaign (reference delete_campaign)."""
    cid = digits_customer_id(customer_id)
    camp = ''.join(c for c in str(campaign_id or '') if c.isdigit())
    if not cid or not camp:
        return {'ok': False, 'error': 'customer_id and campaign_id are required'}
    client = load_client(google_ads_client_config)
    svc = client.get_service('CampaignService')
    op = client.get_type('CampaignOperation')
    op.remove = svc.campaign_path(cid, camp)
    resp = svc.mutate_campaigns(customer_id=cid, operations=[op])
    return {'ok': True, 'platform_campaign_id': camp, 'resource_name': resp.results[0].resource_name}


def copy_campaign(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    source_campaign_id: str,
    new_name: str,
    budget_amount: Optional[float] = None,
) -> Dict[str, Any]:
    """Copy campaign via get + create_search_campaign (reference copy_campaign simplified)."""
    src = get_campaign(
        google_ads_client_config,
        customer_id=customer_id,
        campaign_id=source_campaign_id,
    )
    if not src.get('ok'):
        return src
    camp = src['campaign']
    amount = budget_amount if budget_amount is not None else (camp.get('budget') or {}).get('amount') or 10.0
    from .budgets import create_campaign_budget

    budget_out = create_campaign_budget(
        google_ads_client_config,
        customer_id=customer_id,
        name=f'{new_name} — Budget',
        amount_micros=int(float(amount) * 1_000_000),
    )
    if not budget_out.get('ok'):
        return budget_out
    return create_search_campaign(
        google_ads_client_config,
        customer_id=customer_id,
        name=new_name,
        budget_resource_name=budget_out['budget_resource_name'],
        status='PAUSED',
    )


def create_ad_schedule(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    campaign_id: str,
    schedules: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Dayparting ad schedules on campaign (reference create_ad_schedule)."""
    cid = digits_customer_id(customer_id)
    camp = ''.join(c for c in str(campaign_id or '') if c.isdigit())
    if not cid or not camp or not schedules:
        return {'ok': False, 'error': 'customer_id, campaign_id, and schedules are required'}

    client = load_client(google_ads_client_config)
    crit_svc = client.get_service('CampaignCriterionService')
    camp_path = client.get_service('CampaignService').campaign_path(cid, camp)
    day_enum = client_enum(client, 'DayOfWeekEnum')
    minute_enum = client_enum(client, 'MinuteOfHourEnum')
    status_enum = client_enum(client, 'CampaignCriterionStatusEnum')

    ops = []
    applied: List[Dict[str, Any]] = []
    for sched in schedules:
        dow = str(sched.get('day_of_week') or 'MONDAY').strip().upper()
        op = client.get_type('CampaignCriterionOperation')
        crit = op.create
        crit.campaign = camp_path
        info = client.get_type('AdScheduleInfo')
        info.day_of_week = resolve_enum(day_enum, dow, 'day_of_week')
        info.start_hour = int(sched.get('start_hour', 0))
        info.end_hour = int(sched.get('end_hour', 23))
        info.start_minute = resolve_enum(minute_enum, 'ZERO', 'start_minute')
        info.end_minute = resolve_enum(minute_enum, 'ZERO', 'end_minute')
        crit.ad_schedule = info
        bid_mod = float(sched.get('bid_modifier', 1.0))
        crit.bid_modifier = bid_mod
        crit.status = resolve_enum(status_enum, 'ENABLED', 'status')
        ops.append(op)
        applied.append({
            'day_of_week': dow,
            'start_hour': info.start_hour,
            'end_hour': info.end_hour,
            'bid_modifier': bid_mod,
        })

    try:
        resp = crit_svc.mutate_campaign_criteria(customer_id=cid, operations=ops)
    except GoogleAdsException as exc:  # type: ignore[misc]
        parts = [getattr(e, 'message', str(e)) for e in getattr(getattr(exc, 'failure', None), 'errors', []) or []]
        return {'ok': False, 'error': parts[0] if parts else str(exc)}

    return {
        'ok': True,
        'schedules_applied': len(applied),
        'schedules': applied,
        'resource_names': [r.resource_name for r in resp.results],
    }
