"""Google Ads assets (reference tools_assets.py)."""

from __future__ import annotations

import base64
import re
from typing import Any, Dict, List, Optional

from .api import GoogleAdsException, digits_customer_id, format_google_ads_exception, load_client


def upload_image_asset(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    image_data: str,
    name: str,
) -> Dict[str, Any]:
    cid = digits_customer_id(customer_id)
    if not cid or not (name or '').strip():
        return {'ok': False, 'error': 'customer_id and name are required'}
    raw = (image_data or '').strip()
    if raw.startswith('data:image') and ',' in raw:
        raw = raw.split(',', 1)[1]
    try:
        image_bytes = base64.b64decode(raw)
    except Exception as exc:
        return {'ok': False, 'error': f'Invalid base64 image_data: {exc}'}
    client = load_client(google_ads_client_config)
    svc = client.get_service('AssetService')
    op = client.get_type('AssetOperation')
    asset = op.create
    asset.name = name.strip()
    asset.image_asset.data = image_bytes
    asset.type_ = client.enums.AssetTypeEnum.IMAGE
    try:
        resp = svc.mutate_assets(customer_id=cid, operations=[op])
    except GoogleAdsException as exc:
        return {'ok': False, 'error': format_google_ads_exception(exc)}
    rn = resp.results[0].resource_name
    return {'ok': True, 'asset_resource_name': rn, 'asset_id': rn.split('/')[-1], 'size_bytes': len(image_bytes)}


def upload_text_asset(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    text: str,
    name: str,
) -> Dict[str, Any]:
    cid = digits_customer_id(customer_id)
    if not cid or not (text or '').strip():
        return {'ok': False, 'error': 'customer_id and text are required'}
    client = load_client(google_ads_client_config)
    svc = client.get_service('AssetService')
    op = client.get_type('AssetOperation')
    asset = op.create
    asset.name = (name or text[:30]).strip()
    asset.text_asset.text = text.strip()
    asset.type_ = client.enums.AssetTypeEnum.TEXT
    try:
        resp = svc.mutate_assets(customer_id=cid, operations=[op])
    except GoogleAdsException as exc:
        return {'ok': False, 'error': format_google_ads_exception(exc)}
    rn = resp.results[0].resource_name
    return {'ok': True, 'asset_resource_name': rn, 'asset_id': rn.split('/')[-1], 'text': text.strip()}


def list_assets(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    asset_type: Optional[str] = None,
    limit: int = 100,
) -> Dict[str, Any]:
    cid = digits_customer_id(customer_id)
    if not cid:
        return {'ok': False, 'error': 'customer_id is required'}
    client = load_client(google_ads_client_config)
    ga = client.get_service('GoogleAdsService')
    q = """
      SELECT asset.id, asset.name, asset.type, asset.resource_name
      FROM asset
      WHERE asset.type != 'UNKNOWN'
    """
    if asset_type and re.match(r'^[A-Z_]+$', str(asset_type).strip().upper()):
        q += f" AND asset.type = '{str(asset_type).strip().upper()}'"
    q += ' ORDER BY asset.name LIMIT 200'
    items: List[Dict[str, Any]] = []
    for row in ga.search(customer_id=cid, query=q):
        a = row.asset
        items.append({
            'asset_id': str(a.id),
            'name': a.name,
            'type': str(a.type_.name if hasattr(a.type_, 'name') else a.type_),
            'resource_name': a.resource_name,
        })
        if len(items) >= max(1, min(int(limit or 100), 500)):
            break
    return {'ok': True, 'data': items, 'count': len(items)}


def _extract_youtube_video_id(value: str) -> str | None:
    raw = (value or '').strip()
    if not raw:
        return None
    if re.match(r'^[\w-]{11}$', raw):
        return raw
    m = re.search(r'(?:v=|/embed/|youtu\.be/)([\w-]{11})', raw)
    return m.group(1) if m else None


def create_youtube_video_asset(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    youtube_video_id: str | None = None,
    youtube_url: str | None = None,
    name: str | None = None,
) -> Dict[str, Any]:
    """AssetService — YOUTUBE_VIDEO asset from video ID or YouTube URL."""
    cid = digits_customer_id(customer_id)
    vid = _extract_youtube_video_id(youtube_video_id or '') or _extract_youtube_video_id(youtube_url or '')
    if not cid or not vid:
        return {'ok': False, 'error': 'customer_id and youtube_video_id or youtube_url are required'}

    client = load_client(google_ads_client_config)
    svc = client.get_service('AssetService')
    op = client.get_type('AssetOperation')
    asset = op.create
    asset.name = (name or f'YouTube {vid}').strip()[:255]
    asset.type_ = client.enums.AssetTypeEnum.YOUTUBE_VIDEO
    asset.youtube_video_asset.youtube_video_id = vid
    try:
        resp = svc.mutate_assets(customer_id=cid, operations=[op])
    except GoogleAdsException as exc:
        return {'ok': False, 'error': format_google_ads_exception(exc)}
    rn = resp.results[0].resource_name
    return {
        'ok': True,
        'asset_resource_name': rn,
        'asset_id': rn.split('/')[-1],
        'youtube_video_id': vid,
    }
