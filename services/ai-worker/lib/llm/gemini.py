"""Gemini API transport — keys and models come from workspace config (Settings → AI)."""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

BASE = 'https://generativelanguage.googleapis.com/v1beta/models'


def _api_key(workspace_id: str | None = None) -> str:
    from lib.ai_provider_config import resolve_api_key

    return resolve_api_key('gemini', workspace_id)


def _headers(workspace_id: str | None = None) -> dict[str, str]:
    return {'Content-Type': 'application/json', 'X-goog-api-key': _api_key(workspace_id)}


def _gemini_url(model: str, action: str = 'generateContent') -> str:
    return f'{BASE}/{model}:{action}'


def _wid(body: dict | None) -> str | None:
    w = (body or {}).get('workspace_id')
    return str(w).strip() if w else None


def _configured_model(body: dict | None) -> str:
    m = ((body or {}).get('api_model_id') or (body or {}).get('ai_model') or '').strip()
    if not m:
        raise RuntimeError(
            'Gemini model is not configured. Set provider and model under Settings → AI.'
        )
    return m


def _request_generate(
    client: httpx.Client,
    model: str,
    payload: dict,
    workspace_id: str | None = None,
) -> tuple[int, dict]:
    url = _gemini_url(model)
    try:
        res = client.post(url, headers=_headers(workspace_id), json=payload, timeout=120.0)
        try:
            data = res.json()
        except Exception:
            data = {'error': {'message': 'Invalid JSON response from Gemini API'}}
        return res.status_code, data
    except Exception as exc:
        return 0, {'error': {'message': str(exc)}}


def _model_error_message(data: dict) -> str:
    return f"{data.get('error', {}).get('message', '') or ''}".lower()


def _is_image_generation_unsupported(status: int, data: dict) -> bool:
    msg = _model_error_message(data)
    if status == 404 or 'is not found' in msg or 'model not found' in msg:
        return True
    if 'responsemodalities' in msg or 'response modalities' in msg:
        return True
    if 'image' in msg and 'not supported' in msg:
        return True
    if 'does not support' in msg and 'image' in msg:
        return True
    if 'only supports text' in msg:
        return True
    return False


def _gemini_uses_thinking_budget(model: str) -> bool:
    """Gemini 2.5+ thinking tokens share maxOutputTokens and can truncate JSON."""
    m = (model or '').lower()
    return '2.5' in m or m.startswith('gemini-3')


def complete_text(
    client: httpx.Client,
    prompt: str,
    *,
    model: str,
    workspace_id: str | None = None,
    temperature: float = 0.85,
    max_tokens: int = 2048,
    json_mode: bool = False,
) -> tuple[str, dict]:
    """Text completion using the configured Gemini model only (no model fallback)."""
    from lib.llm.usage import from_gemini_response

    api_model = (model or '').strip()
    if not api_model:
        raise RuntimeError(
            'Gemini model is not configured. Set provider and model under Settings → AI.'
        )
    gen_config: dict[str, Any] = {'temperature': temperature, 'maxOutputTokens': max_tokens}
    if json_mode:
        gen_config['responseMimeType'] = 'application/json'
    if _gemini_uses_thinking_budget(api_model):
        # Thinking tokens count against maxOutputTokens — disable for structured JSON tasks.
        gen_config['thinkingConfig'] = {'thinkingBudget': 0}
    payload = {
        'contents': [{'parts': [{'text': prompt}]}],
        'generationConfig': gen_config,
    }
    status, data = _request_generate(client, api_model, payload, workspace_id)
    if not (200 <= status < 300):
        err = data.get('error', {}).get('message') or json.dumps(data)
        raise RuntimeError(f'Gemini AI error: {err}')
    text = (
        (data.get('candidates') or [{}])[0]
        .get('content', {})
        .get('parts', [{}])[0]
        .get('text')
        or ''
    )
    return text, from_gemini_response(data)


def generate_image(client: httpx.Client, body: dict) -> dict[str, str]:
    """Image generation using the configured Gemini image model only."""
    from lib.llm.social_image import build_image_prompt

    prompt = (body.get('prompt') or '').strip()
    if not prompt:
        raise ValueError('Image prompt is required')
    full_prompt = build_image_prompt(prompt, body)
    gen_config: dict[str, Any] = {'responseModalities': ['IMAGE', 'TEXT']}
    aspect = (body.get('gemini_aspect_ratio') or '').strip()
    if aspect:
        gen_config['imageConfig'] = {'aspectRatio': aspect}
    payload = {
        'contents': [{'parts': [{'text': full_prompt}]}],
        'generationConfig': gen_config,
    }

    wid = _wid(body)
    api_model = _configured_model(body)
    status, data = _request_generate(client, api_model, payload, wid)

    if not (200 <= status < 300):
        err = data.get('error', {}).get('message') or json.dumps(data)
        hint = ''
        if _is_image_generation_unsupported(status, data):
            hint = ' Pick an image-capable Gemini model under Settings → AI → Image Generation.'
        raise RuntimeError(f'Gemini image error: {err}.{hint}')

    parts = (data.get('candidates') or [{}])[0].get('content', {}).get('parts') or []
    image_part = next(
        (p for p in parts if str((p.get('inlineData') or {}).get('mimeType', '')).startswith('image/')),
        None,
    )
    if not image_part:
        raise RuntimeError(
            'No image returned from Gemini. Use an image-capable model under Settings → AI → Image Generation.'
        )
    inline = image_part.get('inlineData') or {}
    mime = inline.get('mimeType')
    b64 = inline.get('data')
    from lib.llm.usage import from_gemini_response

    out: dict[str, Any] = {'image': f'data:{mime};base64,{b64}'}
    usage = from_gemini_response(data)
    if any(usage.values()):
        out['_usage'] = usage
    return out


# Backward-compatible alias used by text.py
def _text_generate(
    client: httpx.Client,
    system_prompt: str,
    temperature: float,
    max_tokens: int,
    workspace_id: str | None = None,
    *,
    model: str | None = None,
) -> tuple[str, str]:
    text, _usage = complete_text(
        client,
        system_prompt,
        model=model or '',
        workspace_id=workspace_id,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return text, (model or '').strip()


def dispatch(opcode: str, payload: dict) -> Any:
    """Backward-compatible entry — prefer ``lib.llm.router.dispatch``."""
    from lib.llm.router import dispatch as route_dispatch

    return route_dispatch(opcode, payload)
