"""Shared Instagram Content Publishing helpers (Graph ``…/media`` + ``…/media_publish``)."""

from __future__ import annotations

import hashlib
import io
import logging
import os
from pathlib import Path
import time
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

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


def _internal_api_base() -> str:
    return (os.getenv('INTERNAL_API_URL') or 'http://127.0.0.1:4010').rstrip('/')


def host_unreliable_for_meta_fetch(url: str) -> bool:
    """True when Meta's crawlers often cannot reach the host (local / free tunnels)."""
    host = (urlparse(url).hostname or '').lower()
    if not host:
        return True
    if host in ('localhost', '127.0.0.1', '::1') or host.endswith('.local'):
        return True
    return 'ngrok' in host or host.endswith('.loca.lt') or host.endswith('.trycloudflare.com')


def resolve_local_upload_path(url: str) -> Optional[Path]:
    path = urlparse(url).path or ''
    marker = '/uploads/'
    if marker not in path:
        return None
    name = path.split(marker, 1)[1]
    if not name or '..' in name or name.startswith('/'):
        return None
    candidate = _api_upload_dir() / name
    return candidate if candidate.is_file() else None


def rewrite_upload_url_for_worker(url: str) -> str:
    """Prefer INTERNAL_API_URL for worker-side /uploads fetches (skip public tunnel)."""
    parsed = urlparse(url)
    path = parsed.path or ''
    if '/uploads/' not in path:
        return url
    return f'{_internal_api_base()}{path}'


def load_media_bytes(item: dict) -> Optional[bytes]:
    """Load bytes from local uploads dir, else INTERNAL rewrite, else public URL."""
    url = str(item.get('url') or '').strip()
    if not url:
        return None
    local = resolve_local_upload_path(url)
    if local is not None:
        try:
            return local.read_bytes()
        except OSError as exc:
            logger.warning('[instagram] local media read failed %s: %s', local, exc)
    fetch_url = rewrite_upload_url_for_worker(url)
    try:
        resp = httpx.get(fetch_url, timeout=300.0, follow_redirects=True)
        resp.raise_for_status()
        return resp.content
    except Exception as exc:
        if fetch_url != url:
            try:
                resp = httpx.get(url, timeout=300.0, follow_redirects=True)
                resp.raise_for_status()
                return resp.content
            except Exception as exc2:
                logger.warning('[instagram] media download failed: %s / %s', exc, exc2)
                return None
        logger.warning('[instagram] media download failed: %s', exc)
        return None


def _convert_png_to_jpeg(item: dict) -> dict:
    try:
        from PIL import Image
    except ImportError as exc:
        raise ValueError('Instagram PNG auto-convert requires Pillow in the worker environment.') from exc

    source_url = item.get('url') or ''
    if not source_url:
        raise ValueError('Instagram PNG image is missing a URL to convert.')

    content = load_media_bytes(item)
    if content is None:
        resp = httpx.get(source_url, timeout=120.0, follow_redirects=True)
        resp.raise_for_status()
        content = resp.content

    digest = hashlib.sha256(content).hexdigest()[:24]
    upload_dir = _api_upload_dir()
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename = f'ig-{digest}.jpg'
    target = upload_dir / filename

    if not target.exists():
        with Image.open(io.BytesIO(content)) as img:
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
    """Poll ``GET {session}/{id}?fields=status_code,status`` until ``FINISHED``."""
    url = f'{session.rstrip("/")}/{container_id}'
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        r = httpx.get(
            url,
            params={'fields': 'status_code,status', 'access_token': token},
            timeout=60.0,
        )
        r.raise_for_status()
        body = r.json() or {}
        code = body.get('status_code')
        if code == 'FINISHED':
            return
        if code == 'ERROR':
            detail = str(body.get('status') or '').strip() or 'unknown error'
            raise RuntimeError(f'Instagram media container failed: {detail}')
        time.sleep(poll_s)
    raise RuntimeError('Instagram media container timed out')


def _apply_cover_fields(payload: Dict[str, Any], cover_url: Optional[str]) -> None:
    """Prefer cover_url only when Meta can reliably fetch it; else first-frame thumb."""
    if cover_url and not host_unreliable_for_meta_fetch(cover_url):
        payload['cover_url'] = cover_url
    else:
        payload['thumb_offset'] = '0'


def _resumable_upload_video(
    *,
    root: str,
    ig_id: str,
    token: str,
    payload: Dict[str, Any],
    video_bytes: bytes,
) -> str:
    create = httpx.post(f'{root.rstrip("/")}/{ig_id}/media', data=payload, timeout=120.0)
    create.raise_for_status()
    body = create.json() or {}
    cid = str(body.get('id') or '')
    if not cid:
        raise RuntimeError('Instagram resumable container returned no id')
    upload_uri = str(body.get('uri') or '').strip()
    if not upload_uri:
        # graph.instagram.com may omit uri; rupload path still accepts the container id.
        ver = root.rstrip('/').rsplit('/', 1)[-1]
        if ver.startswith('v') and ver[1:2].isdigit():
            upload_uri = f'https://rupload.facebook.com/ig-api-upload/{ver}/{cid}'
        else:
            upload_uri = f'https://rupload.facebook.com/ig-api-upload/{cid}'
    up = httpx.post(
        upload_uri,
        headers={
            'Authorization': f'OAuth {token}',
            'offset': '0',
            'file_size': str(len(video_bytes)),
            'Content-Type': 'application/octet-stream',
        },
        content=video_bytes,
        timeout=300.0,
    )
    if up.status_code >= 400:
        detail = (up.text or '')[:400]
        raise RuntimeError(f'Instagram resumable upload HTTP {up.status_code}: {detail}')
    up_body = {}
    try:
        up_body = up.json() if up.content else {}
    except Exception:
        up_body = {}
    if isinstance(up_body, dict) and up_body.get('success') is False:
        raise RuntimeError(f'Instagram resumable upload failed: {up_body}')
    wait_media_container(session=root, container_id=cid, token=token)
    return cid


def create_ig_video_container(
    *,
    root: str,
    ig_id: str,
    token: str,
    video_item: dict,
    media_type: str,
    caption: str = '',
    cover_url: Optional[str] = None,
    is_carousel_item: bool = False,
) -> str:
    """
    Create an IG video/REELS/STORIES container.

    Prefers resumable byte upload (worker → Meta) so publishing works when the
    public ``video_url`` host is unreachable to Meta (e.g. free ngrok). Falls
    back to ``video_url`` for Meta to fetch.
    """
    video_url = str(video_item.get('url') or '').strip()
    base: Dict[str, Any] = {
        'media_type': media_type,
        'access_token': token,
    }
    if caption:
        base['caption'] = caption
    if is_carousel_item:
        base['is_carousel_item'] = 'true'
    _apply_cover_fields(base, cover_url)

    video_bytes = load_media_bytes(video_item)
    if video_bytes is not None:
        try:
            return _resumable_upload_video(
                root=root,
                ig_id=ig_id,
                token=token,
                payload={**base, 'upload_type': 'resumable'},
                video_bytes=video_bytes,
            )
        except Exception as exc:
            logger.warning('[instagram] resumable upload failed, falling back to video_url: %s', exc)

    if not video_url:
        raise RuntimeError('Instagram video publish missing url')
    payload = {**base, 'video_url': video_url}
    r = httpx.post(f'{root.rstrip("/")}/{ig_id}/media', data=payload, timeout=120.0)
    r.raise_for_status()
    cid = str((r.json() or {}).get('id') or '')
    if not cid:
        raise RuntimeError('Instagram media container returned no id')
    wait_media_container(session=root, container_id=cid, token=token)
    return cid
