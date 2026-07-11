"""Normalize video bytes for TikTok Direct Post (dimension + codec checks)."""

from __future__ import annotations

import io
import json
import logging
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

MIN_DIM = 360
MAX_DIM = 4096
TIKTOK_TITLE_MAX = 2200
# Prepends a brief still from the cover image at t=0; platforms use the first frame automatically.
COVER_CLIP_SECONDS = 0.1
# Near-lossless still encode — only ~0.1s; independent of main video bitrate.
COVER_INJECT_CRF = 0


@dataclass(frozen=True)
class TikTokVideoPrepResult:
    ok: bool
    video_bytes: bytes
    error: str | None = None


def _ffmpeg_bin() -> str:
    return os.getenv('FFMPEG_PATH', 'ffmpeg')


def _ffprobe_bin() -> str:
    return os.getenv('FFPROBE_PATH', 'ffprobe')


def ffmpeg_available() -> bool:
    return bool(shutil.which(_ffmpeg_bin()) and shutil.which(_ffprobe_bin()))


def probe_video(video_bytes: bytes) -> dict[str, Any]:
    """Return width, height, codec, fps for the first video stream (empty dict if unknown)."""
    if not video_bytes or not ffmpeg_available():
        return {}
    path = ''
    try:
        with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as tmp:
            tmp.write(video_bytes)
            path = tmp.name
        proc = subprocess.run(
            [
                _ffprobe_bin(),
                '-v',
                'error',
                '-select_streams',
                'v:0',
                '-show_entries',
                'stream=codec_name,profile,width,height,r_frame_rate,pix_fmt',
                '-of',
                'json',
                path,
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            return {}
        streams = (json.loads(proc.stdout or '{}').get('streams') or [])
        if not streams:
            return {}
        stream = streams[0]
        fps = 30.0
        rate = str(stream.get('r_frame_rate') or '')
        if rate and '/' in rate:
            num, den = rate.split('/', 1)
            try:
                n = float(num)
                d = float(den)
                if d > 0:
                    fps = n / d
            except ValueError:
                pass
        return {
            'width': int(stream.get('width') or 0),
            'height': int(stream.get('height') or 0),
            'codec': str(stream.get('codec_name') or ''),
            'fps': fps,
            'profile': str(stream.get('profile') or ''),
            'pix_fmt': str(stream.get('pix_fmt') or 'yuv420p'),
        }
    except Exception as exc:
        logger.warning('[tiktok.video] probe failed: %s', exc)
        return {}
    finally:
        if path:
            Path(path).unlink(missing_ok=True)


def _even(value: int) -> int:
    return value - (value % 2)


def target_dimensions(width: int, height: int) -> tuple[int, int]:
    """Scale so both sides are within TikTok's 360–4096 px range."""
    if width < 1 or height < 1:
        return MIN_DIM, MIN_DIM
    if width >= MIN_DIM and height >= MIN_DIM and width <= MAX_DIM and height <= MAX_DIM:
        return _even(width), _even(height)
    if width < MIN_DIM or height < MIN_DIM:
        scale = max(MIN_DIM / width, MIN_DIM / height)
    else:
        scale = min(MAX_DIM / width, MAX_DIM / height)
    next_w = max(MIN_DIM, min(MAX_DIM, int(width * scale)))
    next_h = max(MIN_DIM, min(MAX_DIM, int(height * scale)))
    return _even(next_w), _even(next_h)


def needs_tiktok_normalization(meta: dict[str, Any]) -> bool:
    width = int(meta.get('width') or 0)
    height = int(meta.get('height') or 0)
    if width < 1 or height < 1:
        return True
    if width < MIN_DIM or height < MIN_DIM or width > MAX_DIM or height > MAX_DIM:
        return True
    codec = (meta.get('codec') or '').lower()
    if codec and codec not in ('h264', 'avc1'):
        return True
    return False


def prepare_video_for_tiktok(video_bytes: bytes) -> TikTokVideoPrepResult:
    """Return TikTok-safe MP4 bytes, transcoding with ffmpeg when needed."""
    meta = probe_video(video_bytes)
    if not needs_tiktok_normalization(meta):
        return TikTokVideoPrepResult(ok=True, video_bytes=video_bytes)

    width = int(meta.get('width') or 0)
    height = int(meta.get('height') or 0)
    target_w, target_h = target_dimensions(width, height)

    if not ffmpeg_available():
        return TikTokVideoPrepResult(
            ok=False,
            video_bytes=video_bytes,
            error=(
                f'Video is {width}x{height}px but TikTok requires each side to be '
                f'between {MIN_DIM} and {MAX_DIM}px. Install ffmpeg in the worker to auto-resize.'
            ),
        )

    src_path = ''
    out_path = ''
    try:
        with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as src:
            src.write(video_bytes)
            src_path = src.name
        out_path = f'{src_path}.tiktok.mp4'
        vf = f'scale={target_w}:{target_h}:flags=lanczos'
        for encoder in ('libx264', 'h264'):
            proc = subprocess.run(
                [
                    _ffmpeg_bin(),
                    '-y',
                    '-i',
                    src_path,
                    '-vf',
                    vf,
                    '-c:v',
                    encoder,
                    '-preset',
                    'fast',
                    '-crf',
                    '23',
                    '-pix_fmt',
                    'yuv420p',
                    '-movflags',
                    '+faststart',
                    '-r',
                    '30',
                    '-an',
                    out_path,
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            if proc.returncode == 0 and Path(out_path).is_file() and Path(out_path).stat().st_size > 0:
                logger.info(
                    '[tiktok.video] resized video from %sx%s to %sx%s for TikTok',
                    width,
                    height,
                    target_w,
                    target_h,
                )
                return TikTokVideoPrepResult(ok=True, video_bytes=Path(out_path).read_bytes())
            logger.warning('[tiktok.video] transcode with %s failed: %s', encoder, (proc.stderr or '')[:300])
        return TikTokVideoPrepResult(
            ok=False,
            video_bytes=video_bytes,
            error=(
                f'Could not resize video ({width}x{height}px) for TikTok. '
                f'Each side must be between {MIN_DIM} and {MAX_DIM}px.'
            ),
        )
    except Exception as exc:
        logger.warning('[tiktok.video] normalize failed: %s', exc)
        return TikTokVideoPrepResult(
            ok=False,
            video_bytes=video_bytes,
            error=f'Could not prepare video ({width}x{height}px) for TikTok: {exc}',
        )
    finally:
        if src_path:
            Path(src_path).unlink(missing_ok=True)
        if out_path:
            Path(out_path).unlink(missing_ok=True)


def friendly_tiktok_fail_reason(reason: str) -> str:
    mapping = {
        'picture_size_check_failed': (
            f'Video dimensions are not supported by TikTok. '
            f'Each side must be between {MIN_DIM} and {MAX_DIM} pixels (9:16 vertical recommended).'
        ),
        'unaudited_client_can_only_post_to_private_accounts': (
            'TikTok app is in sandbox mode: only test accounts added in the TikTok Developer '
            'Portal can receive posts. Add this TikTok account under your app\'s Test Users, '
            'or submit the app for audit to publish to any account.'
        ),
        'spam_risk_too_many_posts': (
            'TikTok blocked this post: the account has published too many videos via the API in '
            'the last 24 hours. Wait and try again later, or post from the TikTok mobile app.'
        ),
    }
    key = (reason or '').strip()
    return mapping.get(key, key or 'TikTok publish failed')


def probe_cover_size(cover_bytes: bytes) -> tuple[int, int]:
    """Return cover image width/height (0,0 if unknown)."""
    if not cover_bytes:
        return 0, 0
    try:
        from PIL import Image

        with Image.open(io.BytesIO(cover_bytes)) as img:
            return int(img.size[0]), int(img.size[1])
    except Exception:
        return 0, 0


def _cover_fit_filter(
    width: int,
    height: int,
    fps: float,
    cover_w: int,
    cover_h: int,
) -> str:
    """
    Fill the video frame without cropping the cover's long axis.

    Portrait cover on landscape video: match width, crop top/bottom only.
    Wide cover on tall video: match height, crop left/right only.
    """
    fps_i = max(1, int(round(fps)))
    if cover_w < 1 or cover_h < 1:
        return (
            f'scale={width}:{height}:force_original_aspect_ratio=increase:flags=lanczos,'
            f'crop={width}:{height},setsar=1,fps={fps_i},format=yuv420p'
        )
    cover_ar = cover_w / cover_h
    video_ar = width / height
    if cover_ar <= video_ar:
        return (
            f'scale={width}:-2:flags=lanczos,'
            f'crop={width}:{height}:0:(ih-{height})/2,'
            f'setsar=1,fps={fps_i},format=yuv420p'
        )
    return (
        f'scale=-2:{height}:flags=lanczos,'
        f'crop={width}:{height}:(iw-{width})/2:0,'
        f'setsar=1,fps={fps_i},format=yuv420p'
    )


def encode_cover_clip(
    cover_bytes: bytes,
    *,
    width: int,
    height: int,
    clip_seconds: float,
    fps: float = 30.0,
    profile: str = '',
    cover_w: int = 0,
    cover_h: int = 0,
) -> bytes | None:
    """Encode only the cover still as a short MP4 matching the main video layout."""
    if not cover_bytes or not ffmpeg_available() or width < 1 or height < 1:
        return None
    cover_suffix = '.png' if cover_bytes[:8] == b'\x89PNG\r\n\x1a\n' else '.jpg'
    src_cover = ''
    out_path = ''
    try:
        with tempfile.NamedTemporaryFile(suffix=cover_suffix, delete=False) as cover_tmp:
            cover_tmp.write(cover_bytes)
            src_cover = cover_tmp.name
        out_path = f'{src_cover}.clip.mp4'
        vf = _cover_fit_filter(width, height, fps, cover_w, cover_h)
        for encoder in ('libx264', 'h264'):
            encode_opts = [
                '-c:v',
                encoder,
                '-preset',
                'slow',
                '-crf',
                str(COVER_INJECT_CRF),
            ]
            if encoder == 'libx264':
                encode_opts.extend(['-tune', 'stillimage'])
                encode_opts.extend(['-x264-params', 'keyint=1:min-keyint=1:scenecut=0'])
            profile_name = str(profile or '').strip()
            if profile_name and encoder == 'libx264':
                idx = encode_opts.index('-crf') + 2
                encode_opts[idx:idx] = ['-profile:v', profile_name.lower()]
            encode_opts.extend(['-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out_path])
            proc = subprocess.run(
                [
                    _ffmpeg_bin(),
                    '-y',
                    '-loop',
                    '1',
                    '-t',
                    str(clip_seconds),
                    '-i',
                    src_cover,
                    '-vf',
                    vf,
                    *encode_opts,
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            if proc.returncode == 0 and Path(out_path).is_file() and Path(out_path).stat().st_size > 0:
                return Path(out_path).read_bytes()
            logger.warning('[tiktok.video] cover clip encode with %s failed: %s', encoder, (proc.stderr or '')[:300])
        return None
    except Exception as exc:
        logger.warning('[tiktok.video] cover clip encode failed: %s', exc)
        return None
    finally:
        for path in (src_cover, out_path):
            if path:
                Path(path).unlink(missing_ok=True)


def concat_mp4_stream_copy(first_bytes: bytes, second_bytes: bytes) -> bytes | None:
    """Concatenate MP4s without re-encoding the main video (requires compatible streams)."""
    if not first_bytes or not second_bytes or not ffmpeg_available():
        return None
    first_path = ''
    second_path = ''
    list_path = ''
    out_path = ''
    try:
        with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as first_tmp:
            first_tmp.write(first_bytes)
            first_path = first_tmp.name
        with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as second_tmp:
            second_tmp.write(second_bytes)
            second_path = second_tmp.name
        out_path = f'{first_path}.merged.mp4'
        list_path = f'{first_path}.txt'
        Path(list_path).write_text(f"file '{first_path}'\nfile '{second_path}'\n", encoding='utf-8')
        proc = subprocess.run(
            [
                _ffmpeg_bin(),
                '-y',
                '-f',
                'concat',
                '-safe',
                '0',
                '-i',
                list_path,
                '-c',
                'copy',
                out_path,
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode == 0 and Path(out_path).is_file() and Path(out_path).stat().st_size > 0:
            return Path(out_path).read_bytes()
        logger.warning('[tiktok.video] concat copy failed: %s', (proc.stderr or '')[:300])
        return None
    except Exception as exc:
        logger.warning('[tiktok.video] concat copy failed: %s', exc)
        return None
    finally:
        for path in (first_path, second_path, list_path, out_path):
            if path:
                Path(path).unlink(missing_ok=True)


def _inject_cover_reencode(
    *,
    src_cover: str,
    src_video: str,
    width: int,
    height: int,
    clip_seconds: float,
    fps: float,
    cover_w: int = 0,
    cover_h: int = 0,
) -> bytes | None:
    """Fallback: re-encode cover + body together."""
    out_path = f'{src_video}.cover.mp4'
    scale_pad = _cover_fit_filter(width, height, fps, cover_w, cover_h)
    fps_i = max(1, int(round(fps)))
    filter_complex = (
        f'[0:v]{scale_pad}[cover];'
        f'[1:v]fps={fps_i},format=yuv420p[body];'
        f'[cover][body]concat=n=2:v=1:a=0[outv]'
    )
    try:
        for encoder in ('libx264', 'h264'):
            encode_opts = [
                '-c:v',
                encoder,
                '-preset',
                'slow',
                '-crf',
                str(COVER_INJECT_CRF),
            ]
            if encoder == 'libx264':
                encode_opts.extend(['-tune', 'stillimage'])
            encode_opts.extend(['-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out_path])
            proc = subprocess.run(
                [
                    _ffmpeg_bin(),
                    '-y',
                    '-loop',
                    '1',
                    '-t',
                    str(clip_seconds),
                    '-i',
                    src_cover,
                    '-i',
                    src_video,
                    '-filter_complex',
                    filter_complex,
                    '-map',
                    '[outv]',
                    *encode_opts,
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            if proc.returncode == 0 and Path(out_path).is_file() and Path(out_path).stat().st_size > 0:
                return Path(out_path).read_bytes()
            logger.warning('[tiktok.video] cover inject with %s failed: %s', encoder, (proc.stderr or '')[:300])
        return None
    finally:
        Path(out_path).unlink(missing_ok=True)


def inject_cover_image(
    video_bytes: bytes,
    cover_bytes: bytes,
    *,
    clip_seconds: float = COVER_CLIP_SECONDS,
) -> tuple[bytes, bool]:
    """
    Prepend a short still from the cover image at t=0 (width-preserved fit).

    Returns ``(video_bytes, injected)``. TikTok/Facebook use the first frame automatically.
    """
    if not cover_bytes or not ffmpeg_available():
        return video_bytes, False

    clip_seconds = max(0.05, float(clip_seconds))

    meta = probe_video(video_bytes)
    width = int(meta.get('width') or 0)
    height = int(meta.get('height') or 0)
    fps = float(meta.get('fps') or 30.0)
    cover_w, cover_h = probe_cover_size(cover_bytes)
    if width < 1 or height < 1:
        return video_bytes, False

    cover_clip = encode_cover_clip(
        cover_bytes,
        width=width,
        height=height,
        clip_seconds=clip_seconds,
        fps=fps,
        profile=str(meta.get('profile') or ''),
        cover_w=cover_w,
        cover_h=cover_h,
    )
    if cover_clip:
        merged = concat_mp4_stream_copy(cover_clip, video_bytes)
        if merged:
            logger.info('[tiktok.video] injected cover via stream copy (%.2fs clip)', clip_seconds)
            return merged, True

    src_video = ''
    src_cover = ''
    try:
        with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as video_tmp:
            video_tmp.write(video_bytes)
            src_video = video_tmp.name
        cover_suffix = '.png' if cover_bytes[:8] == b'\x89PNG\r\n\x1a\n' else '.jpg'
        with tempfile.NamedTemporaryFile(suffix=cover_suffix, delete=False) as cover_tmp:
            cover_tmp.write(cover_bytes)
            src_cover = cover_tmp.name
        merged = _inject_cover_reencode(
            src_cover=src_cover,
            src_video=src_video,
            width=width,
            height=height,
            clip_seconds=clip_seconds,
            fps=fps,
            cover_w=cover_w,
            cover_h=cover_h,
        )
        if merged:
            logger.info('[tiktok.video] injected cover via re-encode fallback (%.2fs clip)', clip_seconds)
            return merged, True
        return video_bytes, False
    except Exception as exc:
        logger.warning('[tiktok.video] cover inject failed: %s', exc)
        return video_bytes, False
    finally:
        for path in (src_video, src_cover):
            if path:
                Path(path).unlink(missing_ok=True)


def extract_video_frame_jpeg(video_bytes: bytes, timestamp_s: float) -> bytes | None:
    """Extract one JPEG frame from video bytes at ``timestamp_s`` (exact video dimensions)."""
    if not video_bytes or not ffmpeg_available():
        return None
    timestamp_s = max(0.0, float(timestamp_s))
    src = ''
    try:
        with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as tmp:
            tmp.write(video_bytes)
            src = tmp.name
        cmd = [_ffmpeg_bin(), '-y', '-i', src]
        if timestamp_s <= 0.001:
            cmd.extend(['-vf', 'select=eq(n\\,0)', '-vsync', 'vfr', '-frames:v', '1'])
        else:
            cmd.extend(['-ss', str(timestamp_s), '-frames:v', '1'])
        cmd.extend(
            [
                '-q:v',
                '1',
                '-f',
                'image2pipe',
                '-vcodec',
                'mjpeg',
                'pipe:1',
            ]
        )
        proc = subprocess.run(
            cmd,
            capture_output=True,
            check=False,
        )
        if proc.returncode == 0 and proc.stdout:
            return proc.stdout
        logger.warning(
            '[tiktok.video] frame extract failed at %.3fs: %s',
            timestamp_s,
            (proc.stderr or b'')[:300],
        )
        return None
    except Exception as exc:
        logger.warning('[tiktok.video] frame extract failed: %s', exc)
        return None
    finally:
        if src:
            Path(src).unlink(missing_ok=True)
