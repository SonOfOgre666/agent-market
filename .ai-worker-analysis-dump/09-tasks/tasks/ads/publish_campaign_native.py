"""
Ads campaign publish orchestration: validation, persistence via **apps/api**.

All platform mutations go through ``tools.ads.registry.run_ads_tool`` (same path as UI
``execute_ads_tool`` and the AI agent). Connectors are only called from tools.
"""

from __future__ import annotations

import logging
from typing import Any, Dict

from bson import ObjectId
from bson.errors import InvalidId

from connectors.google_ads.api import GoogleAdsException, GoogleAdsLibraryMissing
from lib import worker_api
from tools.ads.google.publish_payload import (
    build_google_publish_payload,
    excluded_geo_target_constant_ids,
    geo_target_constant_ids,
    negative_keywords,
)
from tools.ads.meta.publish_payload import build_meta_publish_payload
from tools.ads.registry import run_ads_tool

logger = logging.getLogger(__name__)

GoogleAdsLibraryMissing = GoogleAdsLibraryMissing
GoogleAdsException = GoogleAdsException


class MetaPublishUnsupported(Exception):
    """Handled like Node: publish_errors updated, task fails."""


def _append_publish_error(campaign_id: str, message: str) -> None:
    worker_api.append_campaign_publish_error(campaign_id, message)


def _tool_error(out: Dict[str, Any], fallback: str) -> str:
    return str(out.get('error') or fallback)


def _publish_meta(campaign_id: str, c: Dict[str, Any], account: Dict[str, Any]) -> Dict[str, Any]:
    if not c.get('account_id'):
        raise ValueError('No account_id on campaign — link a Meta Ads connection')

    payload = build_meta_publish_payload(c, account)
    out = run_ads_tool('meta_publish_campaign', payload)
    if not out.get('ok'):
        raise ValueError(_tool_error(out, 'Meta publish failed'))
    return out


def _apply_google_post_publish(
    c: Dict[str, Any],
    platform_campaign_id: str,
    platform_ad_set_id: str | None = None,
) -> None:
    """Geo, exclusions, negatives — reference criterion.py (after campaign exists)."""
    account_id = str(c.get('account_id') or '')
    if not account_id or not platform_campaign_id:
        return

    targeting = dict(c.get('targeting') or {})
    base = {'account_id': account_id, 'platform_campaign_id': str(platform_campaign_id)}

    geo_ids = geo_target_constant_ids(c)
    if geo_ids:
        try:
            geo_out = run_ads_tool(
                'google_create_geo_targeting',
                {**base, 'geo_target_constant_ids': geo_ids},
            )
        except Exception as exc:
            raise ValueError(f'google_create_geo_targeting: {exc}') from exc
        if not geo_out.get('ok'):
            raise ValueError(_tool_error(geo_out, 'google_create_geo_targeting failed'))

    exclude_ids = excluded_geo_target_constant_ids(c)
    if exclude_ids:
        try:
            ex_out = run_ads_tool(
                'google_exclude_geo_targets',
                {**base, 'geo_target_constant_ids': exclude_ids},
            )
        except Exception as exc:
            raise ValueError(f'google_exclude_geo_targets: {exc}') from exc
        if not ex_out.get('ok'):
            raise ValueError(_tool_error(ex_out, 'google_exclude_geo_targets failed'))

    pos_type = targeting.get('positive_geo_target_type')
    neg_type = targeting.get('negative_geo_target_type')
    if pos_type or neg_type:
        gt_out = run_ads_tool(
            'google_update_campaign_geo_target',
            {
                **base,
                'positive_geo_target_type': pos_type,
                'negative_geo_target_type': neg_type,
            },
        )
        if not gt_out.get('ok'):
            raise ValueError(_tool_error(gt_out, 'Google geo target type update failed'))

    neg_kw = negative_keywords(c)
    if neg_kw:
        try:
            nk_out = run_ads_tool(
                'google_add_negative_keywords',
                {**base, 'keywords': neg_kw},
            )
        except Exception as exc:
            raise ValueError(f'google_add_negative_keywords: {exc}') from exc
        if not nk_out.get('ok'):
            raise ValueError(_tool_error(nk_out, 'google_add_negative_keywords failed'))

    sitelinks = targeting.get('sitelinks') or []
    if isinstance(sitelinks, list) and sitelinks:
        try:
            sl_out = run_ads_tool(
                'google_create_sitelink_extensions',
                {**base, 'sitelinks': sitelinks},
            )
        except Exception as exc:
            raise ValueError(f'google_create_sitelink_extensions: {exc}') from exc
        if not sl_out.get('ok'):
            raise ValueError(_tool_error(sl_out, 'google_create_sitelink_extensions failed'))

    callouts = targeting.get('callouts') or []
    if isinstance(callouts, list) and callouts:
        try:
            co_out = run_ads_tool(
                'google_create_callout_extensions',
                {**base, 'callouts': callouts},
            )
        except Exception as exc:
            raise ValueError(f'google_create_callout_extensions: {exc}') from exc
        if not co_out.get('ok'):
            raise ValueError(_tool_error(co_out, 'google_create_callout_extensions failed'))

    schedules = targeting.get('ad_schedules') or []
    if isinstance(schedules, list) and schedules:
        try:
            sch_out = run_ads_tool(
                'google_create_ad_schedule',
                {**base, 'schedules': schedules},
            )
        except Exception as exc:
            raise ValueError(f'google_create_ad_schedule: {exc}') from exc
        if not sch_out.get('ok'):
            raise ValueError(_tool_error(sch_out, 'google_create_ad_schedule failed'))

    bid_adj = targeting.get('bid_adjustments')
    if isinstance(bid_adj, dict) and bid_adj:
        try:
            ba_out = run_ads_tool(
                'google_set_bid_adjustments',
                {**base, 'adjustments': bid_adj},
            )
        except Exception as exc:
            raise ValueError(f'google_set_bid_adjustments: {exc}') from exc
        if not ba_out.get('ok'):
            raise ValueError(_tool_error(ba_out, 'google_set_bid_adjustments failed'))

    audience = targeting.get('audience') or {}
    ag_id = platform_ad_set_id or targeting.get('platform_ad_set_id')
    if isinstance(audience, dict) and ag_id:
        aud_id = audience.get('audience_id')
        if not aud_id and audience.get('name'):
            rules: Dict[str, Any] = {}
            if audience.get('url_contains'):
                rules['url_contains'] = audience['url_contains']
            try:
                ca_out = run_ads_tool(
                    'google_create_custom_audience',
                    {
                        **base,
                        'name': str(audience['name']),
                        'audience_type': 'WEBSITE_VISITORS',
                        'rules': rules or {'url_contains': '/'},
                    },
                )
            except Exception as exc:
                raise ValueError(f'google_create_custom_audience: {exc}') from exc
            if not ca_out.get('ok'):
                raise ValueError(_tool_error(ca_out, 'google_create_custom_audience failed'))
            aud_id = ca_out.get('audience_id')
        if aud_id:
            at_payload: Dict[str, Any] = {
                **base,
                'platform_ad_set_id': str(ag_id),
                'audience_id': str(aud_id),
            }
            if audience.get('bid_modifier') is not None:
                at_payload['bid_modifier'] = audience['bid_modifier']
            try:
                at_out = run_ads_tool('google_add_audience_targeting', at_payload)
            except Exception as exc:
                raise ValueError(f'google_add_audience_targeting: {exc}') from exc
            if not at_out.get('ok'):
                raise ValueError(_tool_error(at_out, 'google_add_audience_targeting failed'))


def _publish_google(campaign_id: str, c: Dict[str, Any], account: Dict[str, Any], bundle: Dict[str, Any]) -> Dict[str, Any]:
    from connectors.google_ads.api import health_check

    if not health_check():
        raise GoogleAdsLibraryMissing()
    if not c.get('account_id'):
        raise ValueError('No account_id on campaign — link a Google Ads connection')

    payload = build_google_publish_payload(c, account)
    try:
        out = run_ads_tool('google_create_campaign', payload)
    except Exception as exc:
        raise ValueError(f'google_create_campaign: {exc}') from exc
    if not out.get('ok'):
        raise ValueError(_tool_error(out, 'google_create_campaign failed'))

    platform_campaign_id = out.get('platform_campaign_id')
    platform_ad_set_id = out.get('platform_ad_set_id')
    if platform_campaign_id:
        _apply_google_post_publish(
            c,
            str(platform_campaign_id),
            str(platform_ad_set_id) if platform_ad_set_id else None,
        )

    return out


def run_native_publish_campaign(campaign_id: str) -> None:
    if not worker_api.configured():
        raise ValueError('WORKER_API_SECRET is not set — cannot publish via API')

    try:
        ObjectId(campaign_id)
    except InvalidId:
        raise ValueError(f'Campaign {campaign_id} not found') from None

    try:
        bundle = worker_api.get_campaign_publish_bundle(campaign_id)
    except Exception:
        raise ValueError(f'Campaign {campaign_id} not found') from None

    c = bundle.get('campaign') or {}
    account = bundle.get('account') or {}

    if c.get('platform_campaign_id'):
        raise ValueError('Campaign already published to the platform')

    platform = (c.get('platform') or '').lower()
    if not account or not account.get('authorized'):
        msg = 'No authorized ad account linked to this campaign.'
        _append_publish_error(campaign_id, msg)
        raise ValueError(msg)

    try:
        if platform in ('meta', 'facebook', 'meta_ads'):
            result = _publish_meta(campaign_id, c, account)
        elif platform == 'google_ads':
            result = _publish_google(campaign_id, c, account, bundle)
        else:
            msg = f'Unsupported ad platform for publish: {platform}'
            _append_publish_error(campaign_id, msg)
            raise ValueError(msg)
    except GoogleAdsException as exc:  # type: ignore[misc]
        parts = []
        failure = getattr(exc, 'failure', None)
        for err in getattr(failure, 'errors', []) or []:
            parts.append(getattr(err, 'message', str(err)))
        msg = parts[0] if parts else str(exc)
        _append_publish_error(campaign_id, msg)
        raise
    except Exception as exc:
        msg = str(exc)
        _append_publish_error(campaign_id, msg)
        if platform in ('meta', 'facebook', 'meta_ads') and 'not implemented' in msg.lower():
            raise MetaPublishUnsupported(msg) from exc
        raise

    worker_api.patch_campaign_google_publish_result(
        campaign_id,
        str(result.get('platform_campaign_id') or result.get('id')),
        str(result['platform_ad_set_id']) if result.get('platform_ad_set_id') else None,
        str(result['platform_ad_id']) if result.get('platform_ad_id') else None,
    )
    logger.info(
        '[publish_campaign_native] published campaign_id=%s platform=%s remote_id=%s',
        campaign_id,
        platform,
        result.get('platform_campaign_id') or result.get('id'),
    )
