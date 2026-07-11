"""Ollama local text completion via /api/chat."""

from __future__ import annotations

import httpx


def complete_text(
    *,
    base_url: str,
    model: str,
    prompt: str,
    temperature: float = 0.85,
    max_tokens: int = 2048,
    api_key: str | None = None,
    timeout: float = 120.0,
) -> tuple[str, dict]:
    root = (base_url or '').strip().rstrip('/')
    if not root:
        raise RuntimeError('Ollama server URL is not configured. Add it under Settings → AI.')

    headers: dict[str, str] = {'Content-Type': 'application/json'}
    key = (api_key or '').strip()
    if key:
        headers['Authorization'] = f'Bearer {key}'

    body = {
        'model': model,
        'messages': [{'role': 'user', 'content': prompt}],
        'stream': False,
        'options': {
            'temperature': temperature,
            'num_predict': max_tokens,
        },
    }

    with httpx.Client(timeout=timeout) as client:
        res = client.post(f'{root}/api/chat', headers=headers, json=body)
        if res.status_code >= 400:
            detail = res.text[:500]
            raise RuntimeError(f'Ollama request failed ({res.status_code}): {detail}')
        data = res.json()

    message = data.get('message') or {}
    text = (message.get('content') or '').strip()
    if not text:
        raise RuntimeError('Ollama returned an empty response')

    usage = {
        'input_tokens': data.get('prompt_eval_count'),
        'output_tokens': data.get('eval_count'),
    }
    if usage['input_tokens'] is not None and usage['output_tokens'] is not None:
        usage['total_tokens'] = int(usage['input_tokens']) + int(usage['output_tokens'])

    return text, usage
