"""OpenAI — chat, images (gpt-image-*), and video (Sora)."""

from __future__ import annotations

import base64
import logging
import time

import httpx

logger = logging.getLogger(__name__)

_IMAGE_PROMPT_MAX_CHARS = 4000
_GPT_IMAGE_PROMPT_MAX_CHARS = 2000
_OPENAI_HTTP_TIMEOUT = httpx.Timeout(connect=30.0, read=300.0, write=60.0, pool=30.0)


def _trim_image_prompt(prompt: str, *, model: str = '') -> str:
    text = (prompt or '').strip()
    limit = _GPT_IMAGE_PROMPT_MAX_CHARS if 'gpt-image' in (model or '').lower() else _IMAGE_PROMPT_MAX_CHARS
    if len(text) <= limit:
        return text
    logger.info('Truncating image prompt from %s to %s chars for model=%s', len(text), limit, model)
    return text[:limit].rstrip() + '…'


def _is_gpt_image_model(model: str) -> bool:
    return 'gpt-image' in (model or '').lower()


def _require_model(model: str, *, context: str) -> str:
    m = (model or '').strip()
    if not m:
        raise RuntimeError(
            f'{context}: AI model is required. Set provider and model under Settings → AI.'
        )
    return m


def complete_text(
    *,
    api_key: str,
    model: str,
    prompt: str,
    temperature: float = 0.85,
    max_tokens: int = 2048,
) -> tuple[str, dict]:
    from lib.llm.usage import from_openai_response

    import openai

    api_model = _require_model(model, context='OpenAI text generation')
    client = openai.OpenAI(api_key=api_key)
    resp = client.chat.completions.create(
        model=api_model,
        messages=[{'role': 'user', 'content': prompt}],
        temperature=temperature,
        max_tokens=max_tokens,
    )
    text = (resp.choices[0].message.content or '').strip()
    return text, from_openai_response(resp)


def generate_image(
    *,
    api_key: str,
    model: str,
    body: dict | None = None,
    prompt: str | None = None,
    style: str = 'realistic',
) -> dict[str, str]:
    from lib.llm.social_image import build_image_prompt

    payload = body or {}
    prompt_text = (prompt or payload.get('prompt') or '').strip()
    style_key = payload.get('style') or style
    api_model = _require_model(model, context='OpenAI image generation')
    full_prompt = _trim_image_prompt(build_image_prompt(prompt_text, payload), model=api_model)

    size = payload.get('openai_size') or '1024x1024'
    quality = payload.get('openai_quality') or ('medium' if _is_gpt_image_model(api_model) else 'standard')

    import openai

    gen_kwargs: dict = {'model': api_model, 'prompt': full_prompt, 'n': 1, 'size': size}
    if _is_gpt_image_model(api_model):
        gen_kwargs['quality'] = quality if quality in ('low', 'medium', 'high') else 'high'
    else:
        gen_kwargs['response_format'] = 'b64_json'

    client = openai.OpenAI(api_key=api_key, timeout=_OPENAI_HTTP_TIMEOUT)
    resp = client.images.generate(**gen_kwargs)
    item = (resp.data or [None])[0]
    if item:
        b64 = getattr(item, 'b64_json', None)
        if b64:
            return {'image': f'data:image/png;base64,{b64}'}
        url = getattr(item, 'url', None)
        if url:
            img = httpx.get(url, timeout=120.0, follow_redirects=True)
            img.raise_for_status()
            enc = base64.b64encode(img.content).decode('ascii')
            mime = img.headers.get('content-type') or 'image/png'
            return {'image': f'data:{mime};base64,{enc}'}
    raise RuntimeError('OpenAI returned no image data')


def generate_video(
    *,
    api_key: str,
    model: str,
    prompt: str,
    seconds: int = 8,
    size: str | None = None,
) -> dict[str, str]:
    """Sora via Videos API — create job, poll, return data URL."""
    api_model = _require_model(model, context='OpenAI video generation')
    headers = {'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'}
    payload: dict[str, str | int] = {
        'model': api_model,
        'prompt': prompt,
        'seconds': seconds,
    }
    if size:
        payload['size'] = size

    r = httpx.post(
        'https://api.openai.com/v1/videos',
        headers=headers,
        json=payload,
        timeout=60.0,
    )
    if r.status_code >= 400:
        err = r.json() if r.content else {}
        msg = err.get('error', {}).get('message') or r.text
        raise RuntimeError(f'OpenAI video error: {msg}')
    video_id = (r.json() or {}).get('id')
    if not video_id:
        raise RuntimeError('OpenAI video job missing id')

    deadline = time.time() + 600
    status = 'queued'
    while time.time() < deadline:
        pr = httpx.get(
            f'https://api.openai.com/v1/videos/{video_id}',
            headers=headers,
            timeout=30.0,
        )
        pr.raise_for_status()
        status = (pr.json() or {}).get('status') or status
        st = str(status or '').lower()
        if st in ('completed', 'succeeded', 'success'):
            break
        if st in ('failed', 'error', 'cancelled'):
            raise RuntimeError(f'OpenAI video generation failed: {status}')
        time.sleep(5)
    else:
        raise RuntimeError('OpenAI video generation timed out')

    content_url = f'https://api.openai.com/v1/videos/{video_id}/content'
    cr = httpx.get(content_url, headers=headers, timeout=300.0, follow_redirects=True)
    if cr.status_code >= 400:
        raise RuntimeError(f'OpenAI video download failed: {cr.status_code}')
    enc = base64.b64encode(cr.content).decode('ascii')
    mime = cr.headers.get('content-type') or 'video/mp4'
    return {'video': f'data:{mime};base64,{enc}', 'video_id': str(video_id)}
