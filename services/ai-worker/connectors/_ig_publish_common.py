"""Shared Instagram Content Publishing helpers (Graph ``…/media`` + ``…/media_publish``)."""

from __future__ import annotations

import hashlib
import io
import logging
import os
from pathlib import Path
import time
from typing import List

import httpx

logger = logging.getLogger(__name__)


def _api_upload_dir() -> Path:
    configured = os.getenv('STORAGE_LOCAL_PATH')
    if configured and Path(configured).is_absolute():
        return Path(configured)
    repo_root = Path(__file__).resolve().parents[3]
    return repo_root / 'apps' / 'api' / 'uploads'


def _api_upload_url(filename: str) -> str:
    base = (os.getenv('API_URL') or 'http://localhost:4010').rstrip('/')
    return f'{base}/uploads/{filename}'


def _convert_png_to_jpeg(item: dict) -> dict:
    try:
        from PIL import Image
    except ImportError as exc:
        raise ValueError('Instagram PNG auto-convert requires Pillow in the worker environment.') from exc

    source_url = item.get('url') or ''
    if not source_url:
        raise ValueError('Instagram PNG image is missing a URL to convert.')

    resp = httpx.get(source_url, timeout=120.0, follow_redirects=True)
    resp.raise_for_status()

    digest = hashlib.sha256(resp.content).hexdigest()[:24]
    upload_dir = _api_upload_dir()
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename = f'ig-{digest}.jpg'
    target = upload_dir / filename

    if not target.exists():
        with Image.open(io.BytesIO(resp.content)) as img:
            if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
                background = Image.new('RGB', img.size, (255, 255, 255))
                alpha = img.convert('RGBA').getchannel('A')
                background.paste(img.convert('RGBA'), mask=alpha)
                output = background
            else:
                output = img.convert('RGB')
            output.save(target, 'JPEG', quality=92, optimize=True)

    converted = {
        **item,
        'url': _api_upload_url(filename),
        'mime_type': 'image/jpeg',
        'name': f'{Path(str(item.get("name") or "image")).stem}.jpg',
        'size': target.stat().st_size,
    }
    converted.pop('conversions', None)
    return converted


def normalize_ig_media_for_publish(all_media: List[dict]) -> List[dict]:
    """Convert Instagram-only PNG inputs to public JPEG URLs before Graph validation."""
    normalized: List[dict] = []
    for item in all_media:
        mime = (item.get('mime_type') or '').lower()
        if mime == 'image/png':
            converted = _convert_png_to_jpeg(item)
            logger.info('[instagram] converted PNG to JPEG for publish: %s', converted.get('url'))
            normalized.append(converted)
        else:
            normalized.append(item)
    return normalized


def validate_ig_media(all_media: List[dict]) -> None:
    max_size = 8 * 1024 * 1024
    allowed_img = {'image/jpeg', 'image/jpg'}
    allowed_vid = {'video/mp4', 'video/quicktime'}
    min_ratio, max_ratio = 0.8, 1.91
    for m in all_media:
        mime = (m.get('mime_type') or '').lower()
        is_video = mime.startswith('video')
        if is_video:
            if mime not in allowed_vid:
                raise ValueError(f'Instagram does not support video format "{mime}". Use MP4 or MOV.')
        else:
            if mime not in allowed_img:
                raise ValueError(f'Instagram does not support image format "{mime}". Convert to JPEG before uploading.')
            if m.get('size') and int(m['size']) > max_size:
                raise ValueError(
                    f'Image "{m.get("name", "")}" is too large — Instagram limit is 8 MB.',
                )
            w, h = m.get('width'), m.get('height')
            if w and h:
                ratio = float(w) / float(h)
                if ratio < min_ratio or ratio > max_ratio:
                    raise ValueError(
                        f'Image "{m.get("name", "")}" aspect ratio {ratio:.2f}:1 — Instagram requires 4:5 to 1.91:1.',
                    )


def wait_media_container(
    *,
    session: str,
    container_id: str,
    token: str,
    timeout: float = 120.0,
    poll_s: float = 3.0,
) -> None:
    """Poll ``GET {session}/{id}?fields=status_code`` until ``FINISHED``."""
    url = f'{session.rstrip("/")}/{container_id}'
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        r = httpx.get(url, params={'fields': 'status_code', 'access_token': token}, timeout=60.0)
        r.raise_for_status()
        code = (r.json() or {}).get('status_code')
        if code == 'FINISHED':
            return
        if code == 'ERROR':
            raise RuntimeError('Instagram media container failed')
        time.sleep(poll_s)
    raise RuntimeError('Instagram media container timed out')
