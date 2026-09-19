"""Optional video cover images (post media with role=thumbnail) at publish time."""

from __future__ import annotations

import io
import logging
import time
from typing import Any
from urllib.parse import urlparse

import httpx

from connectors._tiktok_video import (
    extract_video_frame_jpeg,
    inject_cover_image,
    probe_video,
)

logger = logging.getLogger(__name__)

FACEBOOK_COVER_CLIP_SECONDS = 0.1

# Instagram: cover_url on reel container.
# Facebook/TikTok: inject cover clip; use frame 0 as the cover/thumbnail.


def cover_item_url(item: dict[str, Any] | None) -> str:
    if not item:
        return ''
    return str(item.get('url') or '').strip()


def download_media_from_url(url: str, *, timeout: float = 120.0) -> tuple[bytes, str]:
    resp = httpx.get(url, timeout=timeout, follow_redirects=True)
    resp.raise_for_status()
    mime = (resp.headers.get('content-type') or 'application/octet-stream').split(';')[0].strip().lower()
    return resp.content, mime


def fit_cover_jpeg(cover_bytes: bytes, target_w: int, target_h: int) -> bytes | None:
    """
    Fit cover to target size without cropping the cover's long axis.

    Portrait on landscape: full width, crop top/bottom if needed.
    """
    from PIL import Image

    if not cover_bytes or target_w < 1 or target_h < 1:
        return None
    try:
        with Image.open(io.BytesIO(cover_bytes)) as img:
            if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
                background = Image.new('RGB', img.size, (0, 0, 0))
                alpha = img.convert('RGBA').getchannel('A')
                background.paste(img.convert('RGBA'), mask=alpha)
                working = background
            else:
                working = img.convert('RGB')
            w, h = working.size
            target_ratio = target_w / target_h
            current_ratio = w / h
            if current_ratio <= target_ratio:
                resized = working.resize((target_w, max(1, int(h * (target_w / w)))), Image.Resampling.LANCZOS)
                nh = resized.size[1]
                if nh > target_h:
                    top = (nh - target_h) // 2
                    fitted = resized.crop((0, top, target_w, top + target_h))
                else:
                    canvas = Image.new('RGB', (target_w, target_h), (0, 0, 0))
                    canvas.paste(resized, (0, (target_h - nh) // 2))
                    fitted = canvas
            else:
                resized = working.resize((max(1, int(w * (target_h / h))), target_h), Image.Resampling.LANCZOS)
                nw = resized.size[0]
                if nw > target_w:
                    left = (nw - target_w) // 2
                    fitted = resized.crop((left, 0, left + target_w, target_h))
                else:
                    canvas = Image.new('RGB', (target_w, target_h), (0, 0, 0))
                    canvas.paste(resized, ((target_w - nw) // 2, 0))
                    fitted = canvas
            buf = io.BytesIO()
            fitted.save(buf, 'JPEG', quality=95, optimize=True)
            return buf.getvalue()
    except Exception as exc:
        logger.warning('[video_cover] fit cover jpeg failed: %s', exc)
        return None


# Back-compat alias
letterbox_cover_jpeg = fit_cover_jpeg


def prepare_facebook_video_bytes(
    video_item: dict[str, Any],
    cover_item: dict[str, Any] | None,
) -> tuple[bytes | None, bytes | None, bytes | None, bool]:
    """
    When a cover is attached, prepend a 0.1s still (letterboxed, not cropped).

    Returns ``(upload_bytes, thumb_jpeg, cover_bytes, injected)``.
    ``upload_bytes is None`` → caller should use ``file_url``.
    ``thumb_jpeg`` is frame 0 extracted from the injected upload (same as TikTok t=0).
    """
    video_url = str(video_item.get('url') or '').strip()
    cover_url = cover_item_url(cover_item)
    if not video_url or not cover_url:
        return None, None, None, False
    try:
        video_bytes, _ = download_media_from_url(video_url, timeout=300.0)
        cover_bytes, _ = download_media_from_url(cover_url)
        injected_bytes, injected = inject_cover_image(
            video_bytes,
            cover_bytes,
            clip_seconds=FACEBOOK_COVER_CLIP_SECONDS,
        )
        if not injected:
            logger.warning('[video_cover] Facebook cover inject skipped — ffmpeg or probe failed')
            return None, None, cover_bytes, False
        thumb_jpeg = extract_video_frame_jpeg(injected_bytes, 0.0)
        logger.info(
            '[video_cover] Facebook prepended %.1fs cover still into upload',
            FACEBOOK_COVER_CLIP_SECONDS,
        )
        return injected_bytes, thumb_jpeg, cover_bytes, True
    except Exception as exc:
        logger.warning('[video_cover] Facebook cover inject failed: %s', exc)
        return None, None, None, False


def _facebook_thumb_dimensions(
    *,
    graph_root: str,
    video_id: str,
    access_token: str,
    video_item: dict[str, Any] | None,
) -> tuple[int, int] | None:
    rows = _facebook_thumbnails_list(
        graph_root=graph_root,
        video_id=video_id,
        access_token=access_token,
    )
    if rows:
        w = int(rows[0].get('width') or 0)
        h = int(rows[0].get('height') or 0)
        if w > 0 and h > 0:
            return w, h
    if not video_item:
        return None
    url = str(video_item.get('url') or '').strip()
    if not url:
        return None
    try:
        video_bytes, _ = download_media_from_url(url, timeout=300.0)
        meta = probe_video(video_bytes)
        w = int(meta.get('width') or 0)
        h = int(meta.get('height') or 0)
        return (w, h) if w > 0 and h > 0 else None
    except Exception as exc:
        logger.warning('[video_cover] Facebook thumb dimension probe failed: %s', exc)
        return None


def _facebook_thumbnails_list(
    *,
    graph_root: str,
    video_id: str,
    access_token: str,
) -> list[dict[str, Any]]:
    try:
        r = httpx.get(
            f'{graph_root.rstrip("/")}/{video_id}/thumbnails',
            params={'access_token': access_token},
            timeout=60.0,
        )
        r.raise_for_status()
        rows = (r.json() or {}).get('data') or []
        return [row for row in rows if isinstance(row, dict)]
    except Exception:
        return []


def wait_facebook_video_ready(
    *,
    graph_root: str,
    video_id: str,
    access_token: str,
    timeout: float = 180.0,
    poll_s: float = 5.0,
) -> None:
    """Poll until ``video_status`` is ``ready`` (thumbnails API requires processed video)."""
    url = f'{graph_root.rstrip("/")}/{video_id}'
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        r = httpx.get(
            url,
            params={'fields': 'status', 'access_token': access_token},
            timeout=60.0,
        )
        r.raise_for_status()
        status = (r.json() or {}).get('status') or {}
        video_status = str(status.get('video_status') or '').lower()
        if video_status == 'ready':
            return
        if video_status == 'error':
            proc = status.get('processing_phase') or {}
            err = proc.get('error') if isinstance(proc, dict) else None
            msg = err.get('message') if isinstance(err, dict) else None
            raise RuntimeError(msg or 'Facebook video processing failed')
        time.sleep(poll_s)
    raise TimeoutError(f'Facebook video {video_id} not ready after {int(timeout)}s')


def _facebook_post_preferred_thumbnail(
    *,
    graph_root: str,
    video_id: str,
    access_token: str,
    jpeg_bytes: bytes,
    before_ids: set[str],
    label: str,
) -> bool:
    endpoint = f'{graph_root.rstrip("/")}/{video_id}/thumbnails'
    r = httpx.post(
        endpoint,
        params={'access_token': access_token, 'is_preferred': 'true'},
        files={'source': ('cover.jpg', jpeg_bytes, 'image/jpeg')},
        timeout=120.0,
    )
    if r.is_error:
        logger.warning(
            '[video_cover] Facebook thumbnail (%s) HTTP %s video=%s: %s',
            label,
            r.status_code,
            video_id,
            r.text[:500] if r.content else r.status_code,
        )
        return False
    payload: Any = r.json() if r.content else {}
    api_ok = bool(isinstance(payload, dict) and payload.get('success'))
    after = _facebook_thumbnails_list(
        graph_root=graph_root,
        video_id=video_id,
        access_token=access_token,
    )
    new_preferred = [
        row for row in after if row.get('is_preferred') and str(row.get('id')) not in before_ids
    ]
    if api_ok and new_preferred:
        logger.info(
            '[video_cover] Facebook preferred thumbnail (%s) video=%s id=%s',
            label,
            video_id,
            new_preferred[0].get('id'),
        )
        return True
    return False


def facebook_apply_injected_cover_thumbnail(
    *,
    video_id: str,
    cover_bytes: bytes,
    thumb_jpeg: bytes | None,
    upload_bytes: bytes | None,
    access_token: str,
    graph_root: str,
    video_item: dict[str, Any] | None = None,
) -> bool:
    """
    Set Facebook preferred thumbnail from frame 0 of the injected upload.

    Fallback: fit original cover JPEG if frame extract fails.
    """
    try:
        wait_facebook_video_ready(
            graph_root=graph_root,
            video_id=video_id,
            access_token=access_token,
        )
    except Exception as exc:
        logger.warning('[video_cover] Facebook video not ready for cover thumbnail: %s', exc)
        return False

    dims = _facebook_thumb_dimensions(
        graph_root=graph_root,
        video_id=video_id,
        access_token=access_token,
        video_item=video_item,
    )
    if not dims:
        logger.warning('[video_cover] Facebook cover thumb skipped — no dimensions video=%s', video_id)
        return False
    target_w, target_h = dims
    candidates: list[tuple[str, bytes]] = []
    if upload_bytes:
        frame0 = extract_video_frame_jpeg(upload_bytes, 0.0) or thumb_jpeg
        if frame0:
            candidates.append(('frame0', frame0))
    fallback = fit_cover_jpeg(cover_bytes, target_w, target_h)
    if fallback:
        candidates.append(('fit', fallback))

    before_ids = {
        str(row.get('id'))
        for row in _facebook_thumbnails_list(
            graph_root=graph_root,
            video_id=video_id,
            access_token=access_token,
        )
        if row.get('id')
    }
    try:
        for label, jpeg_bytes in candidates:
            if _facebook_post_preferred_thumbnail(
                graph_root=graph_root,
                video_id=video_id,
                access_token=access_token,
                jpeg_bytes=jpeg_bytes,
                before_ids=before_ids,
                label=label,
            ):
                logger.info(
                    '[video_cover] Facebook preferred thumbnail video=%s verified=True size=%sx%s via=%s',
                    video_id,
                    target_w,
                    target_h,
                    label,
                )
                return True
            before_ids = {
                str(row.get('id'))
                for row in _facebook_thumbnails_list(
                    graph_root=graph_root,
                    video_id=video_id,
                    access_token=access_token,
                )
                if row.get('id')
            }
        logger.warning(
            '[video_cover] Facebook cover thumbnail not applied video=%s size=%sx%s',
            video_id,
            target_w,
            target_h,
        )
        return False
    except Exception as exc:
        logger.warning('[video_cover] Facebook cover thumbnail failed video=%s: %s', video_id, exc)
        return False


def instagram_cover_url(item: dict[str, Any] | None) -> str | None:
    """
    Instagram Reels ``cover_url`` — public http(s) URL; Meta cURL-fetches the image.
    See: https://developers.facebook.com/docs/instagram-platform/content-publishing/
    """
    url = cover_item_url(item)
    if not url:
        return None
    if not url.startswith(('http://', 'https://')):
        logger.warning('[video_cover] Instagram cover_url is not http(s): %s', url[:120])
        return None
    parsed = urlparse(url)
    if parsed.query:
        logger.warning(
            '[video_cover] Instagram cover_url has query params; Meta often rejects signed URLs'
        )
    return url
