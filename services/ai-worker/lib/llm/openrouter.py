"""OpenRouter — OpenAI-compatible chat API (https://openrouter.ai)."""

from __future__ import annotations

from lib.llm.usage import from_openai_response


def complete_text(
    *,
    api_key: str,
    model: str,
    prompt: str,
    temperature: float = 0.85,
    max_tokens: int = 2048,
    reasoning: bool = True,
) -> tuple[str, dict]:
    import openai

    api_model = (model or '').strip()
    if not api_model:
        raise RuntimeError(
            'OpenRouter text generation: AI model is required. Set provider and model under Settings → AI.'
        )

    client = openai.OpenAI(
        api_key=api_key,
        base_url='https://openrouter.ai/api/v1',
    )
    kwargs: dict = {
        'model': api_model,
        'messages': [{'role': 'user', 'content': prompt}],
        'temperature': temperature,
        'max_tokens': max_tokens,
    }
    if reasoning:
        kwargs['extra_body'] = {'reasoning': {'enabled': True}}

    resp = client.chat.completions.create(**kwargs)
    text = (resp.choices[0].message.content or '').strip()
    return text, from_openai_response(resp)
