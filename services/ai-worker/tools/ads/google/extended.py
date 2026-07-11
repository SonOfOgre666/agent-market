"""
Additional google_* tool runners — thin wrappers over connectors (reference_ads ports).
Keeps one module to avoid dozens of single-line files; registry maps tool_id here.
"""

from __future__ import annotations

from typing import Any, Dict

from connectors.google_ads import accounts as conn_accounts
from connectors.google_ads import adgroups as conn_adgroups
from connectors.google_ads import advanced as conn_advanced
from connectors.google_ads import assets as conn_assets
from connectors.google_ads import audiences as conn_audiences
from connectors.google_ads import bidding as conn_bidding
from connectors.google_ads import campaigns as conn_campaigns
from connectors.google_ads import extensions as conn_extensions
from connectors.google_ads import geography as conn_geo
from connectors.google_ads import keywords as conn_keywords
from connectors.google_ads.ads import create_expanded_text_ad, list_ads, remove_ad_group_ad, update_ad_group_ad
from connectors.google_ads.api import load_client
from tools.ads._errors import ToolValidationError
from tools.ads.google._config import require_google_config


def _client(payload: Dict[str, Any]):
    gcfg, customer_id = require_google_config(payload)
    return gcfg, customer_id, load_client(gcfg)


def run_get_account_hierarchy(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid = require_google_config(payload)[:2]
    return conn_accounts.fetch_account_hierarchy(gcfg, customer_id=cid)


def run_get_ad_group(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid = require_google_config(payload)[:2]
    agid = payload.get('platform_ad_set_id') or payload.get('ad_group_id')
    if not agid:
        raise ToolValidationError('platform_ad_set_id is required')
    out = conn_adgroups.get_ad_group(gcfg, customer_id=cid, ad_group_id=str(agid))
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'get ad group failed')
    return out


def run_update_adgroup_full(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid = require_google_config(payload)[:2]
    rn = payload.get('ad_group_resource_name')
    if not rn and payload.get('platform_ad_set_id'):
        agid = ''.join(c for c in str(payload['platform_ad_set_id']) if c.isdigit())
        rn = f'customers/{cid}/adGroups/{agid}'
    if not rn:
        raise ToolValidationError('ad_group_resource_name or platform_ad_set_id required')
    cpc = payload.get('cpc_bid_micros')
    if cpc is None and payload.get('cpc_bid') is not None:
        cpc = int(round(float(payload['cpc_bid']) * 1_000_000))
    out = conn_adgroups.update_ad_group(
        gcfg,
        customer_id=cid,
        ad_group_resource_name=str(rn),
        name=payload.get('name'),
        status=payload.get('status'),
        cpc_bid_micros=cpc,
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'update ad group failed')
    return out


def run_list_keywords(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid, client = _client(payload)
    return conn_keywords.list_keywords(
        client, cid,
        campaign_id=payload.get('platform_campaign_id') or payload.get('campaign_id'),
        ad_group_id=payload.get('platform_ad_set_id') or payload.get('ad_group_id'),
        limit=int(payload.get('limit') or 200),
    )


def run_update_keyword_bid(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid, client = _client(payload)
    ag = payload.get('platform_ad_set_id') or payload.get('ad_group_id')
    kw = payload.get('keyword_id') or payload.get('criterion_id')
    micros = payload.get('cpc_bid_micros')
    if micros is None and payload.get('cpc_bid') is not None:
        micros = int(round(float(payload['cpc_bid']) * 1_000_000))
    if not ag or not kw or micros is None:
        raise ToolValidationError('ad_group_id, keyword_id, cpc_bid_micros required')
    return conn_keywords.update_keyword_bid(client, cid, ad_group_id=str(ag), keyword_id=str(kw), cpc_bid_micros=int(micros))


def run_pause_keyword(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid, client = _client(payload)
    return conn_keywords.set_keyword_status(
        client, cid,
        ad_group_id=str(payload.get('platform_ad_set_id') or payload.get('ad_group_id')),
        keyword_id=str(payload.get('keyword_id') or payload.get('criterion_id')),
        status='PAUSED',
    )


def run_enable_keyword(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid, client = _client(payload)
    return conn_keywords.set_keyword_status(
        client, cid,
        ad_group_id=str(payload.get('platform_ad_set_id') or payload.get('ad_group_id')),
        keyword_id=str(payload.get('keyword_id') or payload.get('criterion_id')),
        status='ENABLED',
    )


def run_delete_keyword(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid, client = _client(payload)
    return conn_keywords.remove_keyword(
        client, cid,
        ad_group_id=str(payload.get('platform_ad_set_id') or payload.get('ad_group_id')),
        keyword_id=str(payload.get('keyword_id') or payload.get('criterion_id')),
    )


def run_list_ads_read(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid, client = _client(payload)
    return list_ads(
        client, cid,
        campaign_id=payload.get('platform_campaign_id') or payload.get('campaign_id'),
        ad_group_id=payload.get('platform_ad_set_id') or payload.get('ad_group_id'),
        status=payload.get('status'),
        limit=int(payload.get('limit') or 100),
    )


def run_pause_ad(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid, client = _client(payload)
    return update_ad_group_ad(client, cid, ad_group_id=str(payload['platform_ad_set_id'] or payload['ad_group_id']),
                              ad_id=str(payload['platform_ad_id'] or payload['ad_id']), status='PAUSED')


def run_enable_ad(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid, client = _client(payload)
    return update_ad_group_ad(client, cid, ad_group_id=str(payload['platform_ad_set_id'] or payload['ad_group_id']),
                              ad_id=str(payload['platform_ad_id'] or payload['ad_id']), status='ENABLED')


def run_delete_ad(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid, client = _client(payload)
    return remove_ad_group_ad(client, cid, ad_group_id=str(payload['platform_ad_set_id'] or payload['ad_group_id']),
                              ad_id=str(payload['platform_ad_id'] or payload['ad_id']))


def run_create_structured_snippet_extensions(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid = require_google_config(payload)[:2]
    camp = payload.get('platform_campaign_id') or payload.get('campaign_id')
    snippets = payload.get('structured_snippets') or []
    out = conn_extensions.create_structured_snippet_extensions(gcfg, customer_id=cid, campaign_id=str(camp), structured_snippets=snippets)
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'structured snippets failed')
    return out


def run_create_call_extensions(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid = require_google_config(payload)[:2]
    out = conn_extensions.create_call_asset_extension(
        gcfg, customer_id=cid,
        campaign_id=str(payload.get('platform_campaign_id') or payload.get('campaign_id')),
        phone_number=str(payload.get('phone_number') or ''),
        country_code=payload.get('country_code') or 'US',
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'call extension failed')
    return out


def run_list_extensions(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid = require_google_config(payload)[:2]
    return conn_extensions.list_campaign_assets(
        gcfg, customer_id=cid,
        campaign_id=payload.get('platform_campaign_id') or payload.get('campaign_id'),
        field_type=payload.get('extension_type') or payload.get('field_type'),
    )


def run_delete_extension(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid = require_google_config(payload)[:2]
    rn = payload.get('resource_name') or payload.get('extension_resource_name')
    if not rn:
        raise ToolValidationError('resource_name required')
    return conn_extensions.remove_campaign_asset(gcfg, customer_id=cid, resource_name=str(rn))


def run_upload_image_asset(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid = require_google_config(payload)[:2]
    out = conn_assets.upload_image_asset(gcfg, customer_id=cid, image_data=str(payload.get('image_data') or ''), name=str(payload.get('name') or 'Image'))
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'upload image failed')
    return out


def run_upload_text_asset(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid = require_google_config(payload)[:2]
    out = conn_assets.upload_text_asset(gcfg, customer_id=cid, text=str(payload.get('text') or ''), name=str(payload.get('name') or 'Text'))
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'upload text failed')
    return out


def run_list_assets(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid = require_google_config(payload)[:2]
    return conn_assets.list_assets(gcfg, customer_id=cid, asset_type=payload.get('asset_type'), limit=int(payload.get('limit') or 100))


def run_suggest_negative_keywords(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid = require_google_config(payload)[:2]
    return conn_geo.suggest_negative_keywords_from_search_terms(
        gcfg, customer_id=cid,
        campaign_id=payload.get('platform_campaign_id') or payload.get('campaign_id'),
        date_range=payload.get('date_range') or 'LAST_30_DAYS',
        min_cost=float(payload.get('min_cost') or 5),
        max_suggestions=int(payload.get('max_suggestions') or 20),
    )


def run_get_location_performance(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid = require_google_config(payload)[:2]
    return conn_geo.get_location_performance(
        gcfg, customer_id=cid,
        campaign_id=payload.get('platform_campaign_id') or payload.get('campaign_id'),
        date_range=payload.get('date_range') or 'LAST_30_DAYS',
    )


def run_get_device_performance(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid = require_google_config(payload)[:2]
    return conn_bidding.get_device_performance(
        gcfg, customer_id=cid,
        campaign_id=payload.get('platform_campaign_id') or payload.get('campaign_id'),
        date_range=payload.get('date_range') or 'LAST_30_DAYS',
    )


def run_list_bidding_strategies(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid = require_google_config(payload)[:2]
    return conn_bidding.list_bidding_strategies(gcfg, customer_id=cid)


def run_get_recommendations(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid = require_google_config(payload)[:2]
    return conn_advanced.list_recommendations(gcfg, customer_id=cid, limit=int(payload.get('limit') or 50))


def run_apply_recommendation(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid = require_google_config(payload)[:2]
    rn = payload.get('recommendation_resource_name') or payload.get('resource_name')
    if not rn:
        raise ToolValidationError('recommendation_resource_name required')
    out = conn_advanced.apply_recommendation(gcfg, customer_id=cid, recommendation_resource_name=str(rn))
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'apply recommendation failed')
    return out


def run_get_change_history(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid = require_google_config(payload)[:2]
    return conn_advanced.get_change_history(gcfg, customer_id=cid, date_range=payload.get('date_range') or 'LAST_30_DAYS')


def run_create_ad_schedule(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid = require_google_config(payload)[:2]
    camp = payload.get('platform_campaign_id') or payload.get('campaign_id')
    schedules = payload.get('schedules')
    if not camp:
        raise ToolValidationError('platform_campaign_id is required')
    if not schedules or not isinstance(schedules, list):
        raise ToolValidationError('schedules array is required')
    out = conn_campaigns.create_ad_schedule(
        gcfg, customer_id=cid, campaign_id=str(camp), schedules=schedules,
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'create ad schedule failed')
    return out


def run_create_expanded_text_ad(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid, client = _client(payload)
    agid = payload.get('platform_ad_set_id') or payload.get('ad_group_id')
    if not agid:
        raise ToolValidationError('platform_ad_set_id is required')
    urls = payload.get('final_urls') or payload.get('final_url')
    if isinstance(urls, str):
        urls = [urls]
    out = create_expanded_text_ad(
        client, cid,
        ad_group_id=str(agid),
        headline1=str(payload.get('headline1') or payload.get('headline_1') or ''),
        headline2=str(payload.get('headline2') or payload.get('headline_2') or ''),
        description1=str(payload.get('description1') or payload.get('description') or ''),
        final_urls=list(urls or []),
        headline3=payload.get('headline3'),
        description2=payload.get('description2'),
        status=str(payload.get('status') or 'PAUSED'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or out.get('hint') or 'create expanded text ad failed')
    return out


def run_create_custom_audience(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid = require_google_config(payload)[:2]
    name = payload.get('name')
    if not name:
        raise ToolValidationError('name is required')
    out = conn_audiences.create_custom_audience(
        gcfg, customer_id=cid, name=str(name),
        audience_type=str(payload.get('audience_type') or 'WEBSITE_VISITORS'),
        rules=payload.get('rules') or {},
        description=payload.get('description'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'create custom audience failed')
    return out


def run_add_audience_targeting(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid = require_google_config(payload)[:2]
    agid = payload.get('platform_ad_set_id') or payload.get('ad_group_id')
    aid = payload.get('audience_id') or payload.get('user_list_id')
    if not agid or not aid:
        raise ToolValidationError('platform_ad_set_id and audience_id are required')
    out = conn_audiences.add_audience_targeting(
        gcfg, customer_id=cid, ad_group_id=str(agid), audience_id=str(aid),
        bid_modifier=payload.get('bid_modifier'),
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'add audience targeting failed')
    return out


def run_list_audiences(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid = require_google_config(payload)[:2]
    return conn_audiences.list_audiences(gcfg, customer_id=cid, limit=int(payload.get('limit') or 100))


def run_set_bid_adjustments(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid = require_google_config(payload)[:2]
    camp = payload.get('platform_campaign_id') or payload.get('campaign_id')
    adj = payload.get('adjustments')
    if not camp:
        raise ToolValidationError('platform_campaign_id is required')
    if not adj or not isinstance(adj, dict):
        raise ToolValidationError('adjustments object is required (device, location)')
    out = conn_bidding.set_bid_adjustments(
        gcfg, customer_id=cid, campaign_id=str(camp), adjustments=adj,
    )
    if not out.get('ok'):
        raise ToolValidationError(out.get('error') or 'set bid adjustments failed')
    return out


def run_optimize_geographic_targeting(payload: Dict[str, Any]) -> Dict[str, Any]:
    gcfg, cid = require_google_config(payload)[:2]
    camp = payload.get('platform_campaign_id') or payload.get('campaign_id')
    if not camp:
        raise ToolValidationError('platform_campaign_id is required')
    return conn_geo.optimize_geographic_targeting(
        gcfg, customer_id=cid, campaign_id=str(camp),
        date_range=payload.get('date_range') or 'LAST_30_DAYS',
        min_cost_threshold=float(payload.get('min_cost_threshold') or 20),
        poor_roas_threshold=float(payload.get('poor_roas_threshold') or 1.0),
    )
