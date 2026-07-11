"""Anthropic Messages API — text / JSON generation."""

from __future__ import annotations


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
    from lib.llm.usage import from_anthropic_message

    import anthropic

    api_model = _require_model(model, context='Anthropic text generation')
    client = anthropic.Anthropic(api_key=api_key)
    msg = client.messages.create(
        model=api_model,
        max_tokens=max_tokens,
        temperature=temperature,
        messages=[{'role': 'user', 'content': prompt}],
    )
    parts = []
    for block in msg.content:
        if hasattr(block, 'text'):
            parts.append(block.text)
        elif isinstance(block, dict) and block.get('type') == 'text':
            parts.append(block.get('text') or '')
    text = ''.join(parts).strip()
    return text, from_anthropic_message(msg)
