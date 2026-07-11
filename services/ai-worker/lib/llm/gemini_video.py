"""Gemini API — Veo video generation."""

from __future__ import annotations

import base64
import logging
import time
from typing import Any

import httpx

from lib.ai_provider_config import resolve_api_key

logger = logging.getLogger(__name__)

BASE = 'https://generativelanguage.googleapis.com/v1beta'


def _require_model(model: str) -> str:
    m = (model or '').strip()
    if not m:
        raise RuntimeError(
            'Video model is not configured. Set provider and model under Settings → AI.'
        )
    return m


def _video_data_url(content: bytes, mime: str = 'video/mp4') -> dict[str, str]:
    enc = base64.b64encode(content).decode('ascii')
    return {'video': f'data:{mime};base64,{enc}'}


def _generate_via_sdk(
    api_key: str,
    api_model: str,
    prompt: str,
    duration_seconds: int,
    aspect_ratio: str | None = None,
) -> dict[str, str]:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)
    config_kwargs: dict[str, Any] = {
        'number_of_videos': 1,
        'duration_seconds': duration_seconds,
    }
    if aspect_ratio:
        config_kwargs['aspect_ratio'] = aspect_ratio
    operation = client.models.generate_videos(
        model=api_model,
        prompt=prompt,
        config=types.GenerateVideosConfig(**config_kwargs),
    )
    deadline = time.time() + 600
    while not operation.done:
        if time.time() > deadline:
            raise RuntimeError('Gemini video generation timed out')
        time.sleep(10)
        operation = client.operations.get(operation)

    if getattr(operation, 'error', None):
        raise RuntimeError(str(operation.error))

    result = operation.result
    generated = (getattr(result, 'generated_videos', None) or []) if result else []
    if not generated:
        raise RuntimeError('Gemini returned no generated videos')

    video_file = generated[0].video
    client.files.download(file=video_file)
    path = getattr(video_file, 'name', None) or 'veo_output.mp4'
    save_path = '/tmp/' + path.replace('/', '_')
    video_file.save(save_path)
    with open(save_path, 'rb') as f:
        return _video_data_url(f.read())


def _generate_via_http(
    api_key: str,
    api_model: str,
    prompt: str,
    duration_seconds: int,
    aspect_ratio: str | None = None,
) -> dict[str, str]:
    headers = {'Content-Type': 'application/json', 'X-goog-api-key': api_key}
    config: dict[str, Any] = {'durationSeconds': duration_seconds, 'numberOfVideos': 1}
    if aspect_ratio:
        config['aspectRatio'] = aspect_ratio

    with httpx.Client(timeout=120.0) as client:
        start_url = f'{BASE}/models/{api_model}:generateVideos'
        r = client.post(
            start_url,
            headers=headers,
            json={
                'prompt': prompt,
                'config': config,
            },
        )
        if r.status_code >= 400:
            err = r.json() if r.content else {}
            msg = err.get('error', {}).get('message') or r.text
            raise RuntimeError(f'Gemini video error: {msg}')

        data = r.json()
        op_name = data.get('name')
        if not op_name:
            return _extract_video_from_response(data)

        poll_url = op_name if op_name.startswith('http') else f'{BASE}/{op_name.lstrip("/")}'
        deadline = time.time() + 600
        while time.time() < deadline:
            pr = client.get(poll_url, headers=headers, timeout=60.0)
            if pr.status_code >= 400:
                time.sleep(8)
                continue
            pdata = pr.json()
            if pdata.get('done'):
                if pdata.get('error'):
                    raise RuntimeError(pdata['error'].get('message') or 'Gemini video failed')
                return _extract_video_from_response(pdata.get('response') or pdata)
            time.sleep(8)

    raise RuntimeError('Gemini video generation timed out')


def _extract_video_from_response(data: dict) -> dict[str, str]:
    for key in ('generatedVideos', 'videos', 'predictions'):
        items = data.get(key) or []
        if items:
            item = items[0]
            vid = item.get('video') or item
            b64 = vid.get('bytesBase64Encoded') or vid.get('videoBytes')
            if b64:
                mime = vid.get('mimeType') or 'video/mp4'
                return {'video': f'data:{mime};base64,{b64}'}
            uri = vid.get('uri') or vid.get('fileUri')
            if uri and str(uri).startswith('http'):
                r = httpx.get(uri, timeout=300.0, follow_redirects=True)
                r.raise_for_status()
                return _video_data_url(r.content, r.headers.get('content-type') or 'video/mp4')
    raise RuntimeError('Gemini returned no video in response')


def generate_video(
    *,
    workspace_id: str | None,
    model: str,
    prompt: str,
    duration_seconds: int = 8,
    aspect_ratio: str | None = None,
) -> dict[str, str]:
    api_key = resolve_api_key('gemini', workspace_id)
    if not api_key:
        raise RuntimeError('Gemini API key is not configured. Add it under Settings → AI.')

    api_model = _require_model(model)
    try:
        return _generate_via_sdk(api_key, api_model, prompt, duration_seconds, aspect_ratio)
    except ImportError:
        logger.info('google-genai not installed — using HTTP for Veo')
        return _generate_via_http(api_key, api_model, prompt, duration_seconds, aspect_ratio)
