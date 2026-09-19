"""Google Ads ad mutations."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from .utils import client_enum, enum_value, resolve_enum

logger = logging.getLogger(__name__)


def _validate_rsa_inputs(
    headlines: List[str],
    descriptions: List[str],
    final_url: str,
) -> tuple[List[str], List[str], str, Optional[str]]:
    """Reference create_responsive_search_ad: 3–15 headlines, 2–4 descriptions, final URL."""
    rsa_headlines = [str(h).strip() for h in headlines if h and str(h).strip()]
    rsa_descriptions = [str(d).strip() for d in descriptions if d and str(d).strip()]
    url = (final_url or '').strip()
    if not url:
        return rsa_headlines, rsa_descriptions, url, 'final_url is required'
    if len(rsa_headlines) < 3:
        return (
            rsa_headlines,
            rsa_descriptions,
            url,
            f'at least 3 headlines required (have {len(rsa_headlines)})',
        )
    if len(rsa_descriptions) < 2:
        return (
            rsa_headlines,
            rsa_descriptions,
            url,
            f'at least 2 descriptions required (have {len(rsa_descriptions)})',
        )
    for h in rsa_headlines:
        if len(h) > 30:
            return rsa_headlines, rsa_descriptions, url, f'headline exceeds 30 characters: {h[:24]}…'
    for d in rsa_descriptions:
        if len(d) > 90:
            return rsa_headlines, rsa_descriptions, url, f'description exceeds 90 characters: {d[:24]}…'
    return rsa_headlines, rsa_descriptions, url, None


def create_responsive_search_ad(
    client: Any,
    customer_id: str,
    *,
    ad_group_resource_name: str,
    headlines: List[str],
    descriptions: List[str],
    final_url: str,
    path1: str = '',
    path2: str = '',
    status: str = 'ENABLED',
) -> Dict[str, Optional[str]]:
    """Create a responsive search ad (reference mutations/ad.py create_responsive_search_ad)."""
    rsa_headlines, rsa_descriptions, url, err = _validate_rsa_inputs(headlines, descriptions, final_url)
    if err:
        return {'platform_ad_id': None, 'skipped': True, 'reason': err, 'error': err}

    ad_svc = client.get_service('AdGroupAdService')
    ad_op = client.get_type('AdGroupAdOperation')
    aga = ad_op.create
    aga.ad_group = ad_group_resource_name
    st = (status or 'ENABLED').upper()
    aga.status = resolve_enum(client_enum(client, 'AdGroupAdStatusEnum'), st, 'status')
    ad = aga.ad
    ad.final_urls.append(url)
    ad.type_ = enum_value(client, 'AdTypeEnum', 'RESPONSIVE_SEARCH_AD')
    rsa = ad.responsive_search_ad
    for h in rsa_headlines[:15]:
        ta = client.get_type('AdTextAsset')
        ta.text = h[:30]
        rsa.headlines.append(ta)
    for d in rsa_descriptions[:4]:
        ta = client.get_type('AdTextAsset')
        ta.text = d[:90]
        rsa.descriptions.append(ta)
    p1 = (path1 or '').strip()[:15]
    p2 = (path2 or '').strip()[:15]
    if p1:
        rsa.path1 = p1
    if p2:
        rsa.path2 = p2
    adr = ad_svc.mutate_ad_group_ads(customer_id=customer_id, operations=[ad_op])
    ad_rn = adr.results[0].resource_name
    return {'platform_ad_id': ad_rn.split('/')[-1], 'ad_resource_name': ad_rn}


def _append_ad_image_asset(client: Any, container: Any, asset_resource_name: str) -> None:
    img = client.get_type('AdImageAsset')
    img.asset = asset_resource_name
    container.append(img)


def _append_ad_text_assets(client: Any, container: Any, lines: List[str], *, max_len: int, cap: int) -> None:
    for line in lines[:cap]:
        ta = client.get_type('AdTextAsset')
        ta.text = str(line).strip()[:max_len]
        if ta.text:
            container.append(ta)


def create_responsive_display_ad(
    client: Any,
    customer_id: str,
    *,
    ad_group_resource_name: str,
    final_url: str,
    headlines: List[str],
    descriptions: List[str],
    marketing_image_assets: List[str],
    square_marketing_image_assets: List[str],
    long_headline: str = '',
    business_name: str = '',
    logo_image_assets: Optional[List[str]] = None,
    status: str = 'PAUSED',
) -> Dict[str, Optional[str]]:
    """AdGroupAdService — RESPONSIVE_DISPLAY_AD."""
    url = (final_url or '').strip()
    h = [str(x).strip() for x in headlines if x and str(x).strip()]
    d = [str(x).strip() for x in descriptions if x and str(x).strip()]
    marketing = [str(x).strip() for x in marketing_image_assets if x and str(x).strip()]
    square = [str(x).strip() for x in square_marketing_image_assets if x and str(x).strip()]
    if not url:
        return {'platform_ad_id': None, 'skipped': True, 'error': 'final_url is required'}
    if len(h) < 1:
        return {'platform_ad_id': None, 'skipped': True, 'error': 'at least 1 headline required'}
    if len(d) < 1:
        return {'platform_ad_id': None, 'skipped': True, 'error': 'at least 1 description required'}
    if not marketing or not square:
        return {'platform_ad_id': None, 'skipped': True, 'error': 'marketing and square image assets required'}

    ad_svc = client.get_service('AdGroupAdService')
    ad_op = client.get_type('AdGroupAdOperation')
    aga = ad_op.create
    aga.ad_group = ad_group_resource_name
    aga.status = resolve_enum(client_enum(client, 'AdGroupAdStatusEnum'), status or 'PAUSED', 'status')
    ad = aga.ad
    ad.final_urls.append(url)
    ad.type_ = enum_value(client, 'AdTypeEnum', 'RESPONSIVE_DISPLAY_AD')
    rda = ad.responsive_display_ad
    _append_ad_text_assets(client, rda.headlines, h, max_len=30, cap=5)
    _append_ad_text_assets(client, rda.descriptions, d, max_len=90, cap=5)
    if (long_headline or '').strip():
        lh = client.get_type('AdTextAsset')
        lh.text = long_headline.strip()[:90]
        rda.long_headline = lh
    if (business_name or '').strip():
        rda.business_name = business_name.strip()[:25]
    for rn in marketing[:5]:
        _append_ad_image_asset(client, rda.marketing_images, rn)
    for rn in square[:5]:
        _append_ad_image_asset(client, rda.square_marketing_images, rn)
    for rn in (logo_image_assets or [])[:5]:
        _append_ad_image_asset(client, rda.logo_images, rn)

    adr = ad_svc.mutate_ad_group_ads(customer_id=customer_id, operations=[ad_op])
    ad_rn = adr.results[0].resource_name
    return {'platform_ad_id': ad_rn.split('/')[-1], 'ad_resource_name': ad_rn}


def create_video_responsive_ad(
    client: Any,
    customer_id: str,
    *,
    ad_group_resource_name: str,
    final_url: str,
    youtube_video_asset: str,
    business_name: str,
    logo_image_asset: str,
    headlines: List[str],
    descriptions: List[str],
    long_headlines: Optional[List[str]] = None,
    call_to_action: str = '',
    status: str = 'PAUSED',
) -> Dict[str, Optional[str]]:
    """AdGroupAdService — VIDEO_RESPONSIVE_AD for VIDEO_ACTION campaigns (Google Ads API)."""
    url = (final_url or '').strip()
    vid = (youtube_video_asset or '').strip()
    logo = (logo_image_asset or '').strip()
    bn = (business_name or '').strip()
    h = [str(x).strip() for x in headlines if x and str(x).strip()]
    d = [str(x).strip() for x in descriptions if x and str(x).strip()]
    lh = [str(x).strip() for x in (long_headlines or []) if x and str(x).strip()]
    if not url or not vid or not logo or not bn:
        return {
            'platform_ad_id': None,
            'skipped': True,
            'error': 'final_url, youtube_video_asset, logo_image_asset, business_name required',
        }
    if not h or not d:
        return {'platform_ad_id': None, 'skipped': True, 'error': 'at least 1 headline and 1 description required'}

    ad_svc = client.get_service('AdGroupAdService')
    ad_op = client.get_type('AdGroupAdOperation')
    aga = ad_op.create
    aga.ad_group = ad_group_resource_name
    aga.status = resolve_enum(client_enum(client, 'AdGroupAdStatusEnum'), status or 'PAUSED', 'status')
    ad = aga.ad
    ad.final_urls.append(url)
    ad.type_ = enum_value(client, 'AdTypeEnum', 'VIDEO_RESPONSIVE_AD')
    vra = ad.video_responsive_ad
    vra.business_name = bn[:25]
    _append_ad_image_asset(client, vra.logo_images, logo)
    vid_asset = client.get_type('AdVideoAsset')
    vid_asset.asset = vid
    vra.videos.append(vid_asset)
    _append_ad_text_assets(client, vra.headlines, h, max_len=30, cap=1)
    _append_ad_text_assets(client, vra.descriptions, d, max_len=90, cap=1)
    if lh:
        _append_ad_text_assets(client, vra.long_headlines, lh, max_len=90, cap=1)
    elif h:
        _append_ad_text_assets(client, vra.long_headlines, [h[0]], max_len=90, cap=1)
    cta = (call_to_action or '').strip()
    if cta:
        cta_asset = client.get_type('AdTextAsset')
        cta_asset.text = cta[:10]
        vra.call_to_actions.append(cta_asset)

    adr = ad_svc.mutate_ad_group_ads(customer_id=customer_id, operations=[ad_op])
    ad_rn = adr.results[0].resource_name
    return {'platform_ad_id': ad_rn.split('/')[-1], 'ad_resource_name': ad_rn}


def create_video_ad(
    client: Any,
    customer_id: str,
    *,
    ad_group_resource_name: str,
    final_url: str,
    youtube_video_asset: str,
    headline: str,
    description: str = '',
    status: str = 'PAUSED',
) -> Dict[str, Optional[str]]:
    """AdGroupAdService — VIDEO_AD with YouTube video asset."""
    url = (final_url or '').strip()
    vid_asset = (youtube_video_asset or '').strip()
    h = (headline or '').strip()
    if not url or not vid_asset or not h:
        return {'platform_ad_id': None, 'skipped': True, 'error': 'final_url, youtube_video_asset, headline required'}

    ad_svc = client.get_service('AdGroupAdService')
    ad_op = client.get_type('AdGroupAdOperation')
    aga = ad_op.create
    aga.ad_group = ad_group_resource_name
    aga.status = resolve_enum(client_enum(client, 'AdGroupAdStatusEnum'), status or 'PAUSED', 'status')
    ad = aga.ad
    ad.final_urls.append(url)
    ad.type_ = enum_value(client, 'AdTypeEnum', 'VIDEO_AD')
    video = ad.video_ad
    video.video.asset = vid_asset
    if h:
        video.in_stream.action_headline = h[:15]
    if (description or '').strip():
        video.in_stream.action_button_label = description.strip()[:10]

    adr = ad_svc.mutate_ad_group_ads(customer_id=customer_id, operations=[ad_op])
    ad_rn = adr.results[0].resource_name
    return {'platform_ad_id': ad_rn.split('/')[-1], 'ad_resource_name': ad_rn}


def create_app_ad(
    client: Any,
    customer_id: str,
    *,
    ad_group_resource_name: str,
    headlines: List[str],
    descriptions: List[str],
    image_asset_resource_names: Optional[List[str]] = None,
    youtube_video_assets: Optional[List[str]] = None,
    status: str = 'PAUSED',
) -> Dict[str, Optional[str]]:
    """AdGroupAdService — APP_AD for App campaigns."""
    h = [str(x).strip() for x in headlines if x and str(x).strip()]
    d = [str(x).strip() for x in descriptions if x and str(x).strip()]
    if len(h) < 2 or len(d) < 1:
        return {'platform_ad_id': None, 'skipped': True, 'error': 'at least 2 headlines and 1 description required'}

    ad_svc = client.get_service('AdGroupAdService')
    ad_op = client.get_type('AdGroupAdOperation')
    aga = ad_op.create
    aga.ad_group = ad_group_resource_name
    aga.status = resolve_enum(client_enum(client, 'AdGroupAdStatusEnum'), status or 'PAUSED', 'status')
    ad = aga.ad
    ad.type_ = enum_value(client, 'AdTypeEnum', 'APP_AD')
    app_ad = ad.app_ad
    _append_ad_text_assets(client, app_ad.headlines, h, max_len=30, cap=5)
    _append_ad_text_assets(client, app_ad.descriptions, d, max_len=90, cap=5)
    for rn in (image_asset_resource_names or [])[:20]:
        _append_ad_image_asset(client, app_ad.images, rn)
    for rn in (youtube_video_assets or [])[:20]:
        vid = client.get_type('AdVideoAsset')
        vid.asset = rn
        app_ad.youtube_videos.append(vid)

    adr = ad_svc.mutate_ad_group_ads(customer_id=customer_id, operations=[ad_op])
    ad_rn = adr.results[0].resource_name
    return {'platform_ad_id': ad_rn.split('/')[-1], 'ad_resource_name': ad_rn}


def create_local_ad(
    client: Any,
    customer_id: str,
    *,
    ad_group_resource_name: str,
    final_url: str,
    headlines: List[str],
    descriptions: List[str],
    call_to_actions: Optional[List[str]] = None,
    marketing_image_assets: Optional[List[str]] = None,
    status: str = 'PAUSED',
) -> Dict[str, Optional[str]]:
    """AdGroupAdService — LOCAL_AD."""
    url = (final_url or '').strip()
    h = [str(x).strip() for x in headlines if x and str(x).strip()]
    d = [str(x).strip() for x in descriptions if x and str(x).strip()]
    if not url or len(h) < 1 or len(d) < 1:
        return {'platform_ad_id': None, 'skipped': True, 'error': 'final_url, headlines, descriptions required'}

    ad_svc = client.get_service('AdGroupAdService')
    ad_op = client.get_type('AdGroupAdOperation')
    aga = ad_op.create
    aga.ad_group = ad_group_resource_name
    aga.status = resolve_enum(client_enum(client, 'AdGroupAdStatusEnum'), status or 'PAUSED', 'status')
    ad = aga.ad
    ad.final_urls.append(url)
    ad.type_ = enum_value(client, 'AdTypeEnum', 'LOCAL_AD')
    local = ad.local_ad
    _append_ad_text_assets(client, local.headlines, h, max_len=30, cap=5)
    _append_ad_text_assets(client, local.descriptions, d, max_len=90, cap=5)
    for cta in (call_to_actions or [])[:1]:
        if str(cta).strip():
            local.call_to_actions.append(str(cta).strip())
    for rn in (marketing_image_assets or [])[:5]:
        _append_ad_image_asset(client, local.marketing_images, rn)

    adr = ad_svc.mutate_ad_group_ads(customer_id=customer_id, operations=[ad_op])
    ad_rn = adr.results[0].resource_name
    return {'platform_ad_id': ad_rn.split('/')[-1], 'ad_resource_name': ad_rn}


def list_ads(
    client: Any,
    customer_id: str,
    *,
    campaign_id: str | None = None,
    ad_group_id: str | None = None,
    status: str | None = None,
    limit: int = 100,
) -> Dict[str, Any]:
    """List ads (reference list_ads)."""
    camp = ''.join(c for c in str(campaign_id or '') if c.isdigit()) if campaign_id else ''
    agid = ''.join(c for c in str(ad_group_id or '') if c.isdigit()) if ad_group_id else ''
    q = """
      SELECT
        ad_group_ad.ad.id,
        ad_group_ad.ad.type,
        ad_group_ad.status,
        ad_group_ad.ad.final_urls,
        ad_group.id, ad_group.name,
        campaign.id, campaign.name
      FROM ad_group_ad
      WHERE ad_group_ad.status != 'REMOVED'
    """
    if camp:
        q += f' AND campaign.id = {camp}'
    if agid:
        q += f' AND ad_group.id = {agid}'
    if status and str(status).strip().upper() in ('ENABLED', 'PAUSED'):
        q += f" AND ad_group_ad.status = '{str(status).strip().upper()}'"
    ga = client.get_service('GoogleAdsService')
    items: List[Dict[str, Any]] = []
    for row in ga.search(customer_id=customer_id, query=q):
        aga = row.ad_group_ad
        items.append({
            'ad_id': str(aga.ad.id),
            'platform_ad_id': str(aga.ad.id),
            'type': str(aga.ad.type_.name if hasattr(aga.ad.type_, 'name') else aga.ad.type_),
            'status': str(aga.status.name if hasattr(aga.status, 'name') else aga.status),
            'final_urls': list(aga.ad.final_urls or []),
            'ad_group_id': str(row.ad_group.id),
            'campaign_id': str(row.campaign.id),
        })
        if len(items) >= max(1, min(int(limit or 100), 500)):
            break
    return {'ok': True, 'data': items, 'count': len(items)}


def _ad_group_ad_path(client: Any, customer_id: str, ad_group_id: str, ad_id: str) -> str:
    ag = ''.join(c for c in str(ad_group_id) if c.isdigit())
    aid = ''.join(c for c in str(ad_id) if c.isdigit())
    return client.get_service('AdGroupAdService').ad_group_ad_path(customer_id, ag, aid)


def update_ad_group_ad(
    client: Any,
    customer_id: str,
    *,
    ad_group_id: str,
    ad_id: str,
    status: str | None = None,
) -> Dict[str, Any]:
    from google.protobuf import field_mask_pb2

    svc = client.get_service('AdGroupAdService')
    op = client.get_type('AdGroupAdOperation')
    aga = op.update
    aga.resource_name = _ad_group_ad_path(client, customer_id, ad_group_id, ad_id)
    paths = []
    if status:
        aga.status = enum_value(client, 'AdGroupAdStatusEnum', status.upper())
        paths.append('status')
    if not paths:
        return {'ok': False, 'error': 'status or content update required'}
    op.update_mask.CopyFrom(field_mask_pb2.FieldMask(paths=paths))
    resp = svc.mutate_ad_group_ads(customer_id=customer_id, operations=[op])
    return {'ok': True, 'resource_name': resp.results[0].resource_name}


def remove_ad_group_ad(
    client: Any,
    customer_id: str,
    *,
    ad_group_id: str,
    ad_id: str,
) -> Dict[str, Any]:
    svc = client.get_service('AdGroupAdService')
    op = client.get_type('AdGroupAdOperation')
    op.remove = _ad_group_ad_path(client, customer_id, ad_group_id, ad_id)
    resp = svc.mutate_ad_group_ads(customer_id=customer_id, operations=[op])
    return {'ok': True, 'ad_id': str(ad_id), 'resource_name': resp.results[0].resource_name}


def create_expanded_text_ad(
    client: Any,
    customer_id: str,
    *,
    ad_group_id: str,
    headline1: str,
    headline2: str,
    description1: str,
    final_urls: List[str],
    headline3: Optional[str] = None,
    description2: Optional[str] = None,
    status: str = 'PAUSED',
) -> Dict[str, Any]:
    """Legacy expanded text ad (reference create_expanded_text_ad; may fail on accounts that disallow ETA)."""
    from .api import GoogleAdsException, format_google_ads_exception

    agid = ''.join(c for c in str(ad_group_id) if c.isdigit())
    urls = [u.strip() for u in (final_urls or []) if u and str(u).strip()]
    if not agid or not headline1 or not headline2 or not description1 or not urls:
        return {'ok': False, 'error': 'ad_group_id, headlines, description, final_urls required'}

    svc = client.get_service('AdGroupAdService')
    ag_path = client.get_service('AdGroupService').ad_group_path(customer_id, agid)
    op = client.get_type('AdGroupAdOperation')
    aga = op.create
    aga.ad_group = ag_path
    aga.status = resolve_enum(client_enum(client, 'AdGroupAdStatusEnum'), status, 'status')
    try:
        aga.ad.type_ = enum_value(client, 'AdTypeEnum', 'EXPANDED_TEXT_AD')
        eta = aga.ad.expanded_text_ad
        eta.headline_part1 = headline1[:30]
        eta.headline_part2 = headline2[:30]
        if headline3:
            eta.headline_part3 = headline3[:30]
        eta.description = description1[:90]
        if description2:
            eta.description2 = description2[:90]
        aga.ad.final_urls.extend(urls)
        resp = svc.mutate_ad_group_ads(customer_id=customer_id, operations=[op])
    except GoogleAdsException as exc:  # type: ignore[misc]
        return {'ok': False, 'error': format_google_ads_exception(exc), 'hint': 'Expanded text ads are deprecated; use google_create_ad (RSA).'}
    except (AttributeError, ValueError) as exc:
        return {'ok': False, 'error': str(exc), 'hint': 'Expanded text ads are deprecated; use google_create_ad (RSA).'}

    rn = resp.results[0].resource_name
    return {'ok': True, 'ad_id': rn.split('/')[-1], 'ad_resource_name': rn, 'ad_type': 'EXPANDED_TEXT_AD'}
